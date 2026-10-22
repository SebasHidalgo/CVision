import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every npm script that runs a TypeScript entry through tsx is loaded here
 * under the exact flags its `package.json` line uses, with its main()
 * skipped and the network blocked, so a broken import graph fails `npm test`
 * instead of the owner's terminal. The `react-server` condition the server
 * scripts run under resolves `react` to a build without createContext, so
 * anything that reaches Next's client-side code (`next/navigation`, which
 * `lib/auth` pulls in through Clerk) cannot load there: M6's billing scripts
 * broke that way when a session wrapper landed in the billing data module.
 * A static walk of the same graphs says which file introduced the reach.
 */

const ROOT = path.resolve(__dirname, "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const BLOCK_NETWORK = path.join(ROOT, "scripts", "smoke", "block-network.cjs");

type Script = { name: string; entry: string; flags: string[] };

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

/** The scripts whose command starts with `tsx`, with the entry and the flags around it. */
const SCRIPTS: Script[] = Object.entries(pkg.scripts)
  .filter(([, command]) => command.startsWith("tsx "))
  .map(([name, command]) => {
    const parts = command.split(/\s+/).slice(1);
    const entry = parts.find((part) => part.endsWith(".ts"));
    if (!entry) throw new Error(`npm script "${name}" has no TypeScript entry: ${command}`);
    return { name, entry, flags: parts.filter((part) => part !== entry) };
  });

/** Loads one entry the way its npm script would, without running it or the network. */
function load(script: Script): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX_CLI, ...script.flags, script.entry], {
      cwd: ROOT,
      env: {
        ...process.env,
        CVISION_SCRIPT_SMOKE: "1",
        NODE_OPTIONS: `--require=${BLOCK_NETWORK}`,
        // Import-time checks want a URL; nothing connects (the preload makes sure).
        DATABASE_URL: process.env.DATABASE_URL || "postgresql://smoke:smoke@localhost:5432/smoke?pgbouncer=true",
        DIRECT_URL: process.env.DIRECT_URL || "postgresql://smoke:smoke@localhost:5432/smoke",
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------- static walk

/** `from "x"`, `import("x")`, `require("x")`, and the side-effect form `import "x"` that `server-only` uses. */
const IMPORT_RE = /(?:from\s+|import\s*\(|require\s*\(|^\s*import\s+)["']([^"']+)["']/gm;

/** Bare specifiers that cannot load under the `react-server` condition, or that no script has any business reaching. */
const FORBIDDEN_PACKAGES = ["next/navigation", "next/headers", "next/cache", "react", "react-dom", "@clerk/nextjs", "@clerk/nextjs/server"];

function resolveLocal(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(ROOT, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

type Graph = {
  /** Every repo file reached, with the chain of files that led there. */
  files: Map<string, string[]>;
  /** Every bare package specifier seen, with the file that imports it. */
  packages: Map<string, string>;
};

function walk(entry: string): Graph {
  const graph: Graph = { files: new Map(), packages: new Map() };
  const queue: { file: string; chain: string[] }[] = [{ file: path.join(ROOT, entry), chain: [] }];
  while (queue.length) {
    const { file, chain } = queue.shift()!;
    if (graph.files.has(file)) continue;
    graph.files.set(file, chain);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT_RE)) {
      const specifier = match[1];
      const local = resolveLocal(specifier, file);
      if (local) queue.push({ file: local, chain: [...chain, file] });
      else if (!graph.packages.has(specifier)) graph.packages.set(specifier, file);
    }
  }
  return graph;
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

// ---------------------------------------------------------------- tests

describe("the npm scripts", () => {
  it("are all accounted for", () => {
    expect(SCRIPTS.map((script) => script.name).sort()).toEqual(
      ["agent:sync", "billing:doctor", "billing:reconcile", "billing:sync", "db:check-rls", "eval", "report:guards", "storage:bucket", "storage:gc", "user:set-plan"].sort(),
    );
  });

  it("never reach Next's client code, React or lib/auth through their import graphs", () => {
    const offenders: string[] = [];
    for (const script of SCRIPTS) {
      const graph = walk(script.entry);
      for (const [specifier, importer] of graph.packages) {
        if (FORBIDDEN_PACKAGES.includes(specifier)) {
          const chain = [...(graph.files.get(importer) ?? []), importer].map(relative).join(" -> ");
          offenders.push(`${script.name}: ${chain} -> ${specifier}`);
        }
      }
      const auth = [...graph.files.keys()].find((file) => relative(file).startsWith("lib/auth/"));
      if (auth) offenders.push(`${script.name}: ${[...graph.files.get(auth)!, auth].map(relative).join(" -> ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("carry --conditions=react-server exactly when their graph has a server-only module", () => {
    const wrong: string[] = [];
    for (const script of SCRIPTS) {
      const graph = walk(script.entry);
      const serverOnly = graph.packages.has("server-only");
      const flagged = script.flags.includes("--conditions=react-server");
      if (serverOnly && !flagged) wrong.push(`${script.name} imports a server-only module (${relative(graph.packages.get("server-only")!)}) but runs without --conditions=react-server`);
      if (!serverOnly && flagged) wrong.push(`${script.name} runs with --conditions=react-server but nothing in its graph needs it`);
    }
    expect(wrong).toEqual([]);
  });

  it("load under their own flags without running and without the network", async () => {
    const results = await Promise.all(SCRIPTS.map(async (script) => ({ script, ...(await load(script)) })));
    const failures = results
      .filter(({ code, stderr }) => code !== 0 || /Error|error:/i.test(stderr))
      .map(({ script, code, stderr, stdout }) => `${script.name} (exit ${code}):\n${(stderr || stdout).trim().split("\n").slice(0, 12).join("\n")}`);
    expect(failures).toEqual([]);
    // Skipping main() means a loaded entry prints nothing at all.
    for (const { script, stdout } of results) expect(stdout.trim(), `${script.name} ran its main()`).toBe("");
  }, 120_000);
});
