import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The provider stays behind the adapter. Nothing outside `lib/billing/paddle/`
 * imports the Paddle server SDK, nothing outside `components/billing/paddle/`
 * imports Paddle.js, and the provider-neutral billing modules do not reach
 * into the adapter folder except through the facade. A forced change of
 * provider is then one folder and one line.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SKIP = new Set(["node_modules", ".next", ".git", "docs", "runs", "fixtures.local"]);
const SOURCE = /\.(ts|tsx|mts)$/;

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (SOURCE.test(name)) yield full;
  }
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

const files = [...sourceFiles(ROOT)].map((file) => ({ path: relative(file), text: readFileSync(file, "utf8") }));

const importing = (specifier: string) =>
  files
    .filter((file) => new RegExp(`from\\s+["']${specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["']`).test(file.text))
    .map((file) => file.path);

describe("provider isolation", () => {
  it("only lib/billing/paddle/ imports the Paddle server SDK", () => {
    const outside = importing("@paddle/paddle-node-sdk").filter((file) => !file.startsWith("lib/billing/paddle/"));
    expect(outside).toEqual([]);
  });

  it("only components/billing/paddle/ imports Paddle.js", () => {
    const outside = importing("@paddle/paddle-js").filter((file) => !file.startsWith("components/billing/paddle/"));
    expect(outside).toEqual([]);
  });

  it("the provider-neutral billing modules reach the adapter only through the facade", () => {
    const neutral = files.filter(
      (file) => file.path.startsWith("lib/billing/") && !file.path.startsWith("lib/billing/paddle/") && !file.path.endsWith(".test.ts"),
    );
    const reaching = neutral
      .filter((file) => file.path !== "lib/billing/index.ts" && /from\s+["']\.\/paddle\//.test(file.text))
      .map((file) => file.path);
    expect(reaching).toEqual([]);
  });

  it("nothing outside the adapter and its tests names Paddle's header or field names", () => {
    const offenders = files
      .filter((file) => !file.path.startsWith("lib/billing/paddle/") && !file.path.startsWith("components/billing/paddle/"))
      .filter((file) => !file.path.endsWith(".test.ts") && !file.path.endsWith(".test.tsx"))
      .filter((file) => /paddle-signature|current_billing_period|scheduled_change|customData\.userId/i.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
