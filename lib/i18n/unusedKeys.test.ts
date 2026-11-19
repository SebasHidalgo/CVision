import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { NAMESPACES, type Namespace } from "./config";

/**
 * Every key in locales/ is read by some code, through its own namespace. A key counts as used when its path
 * appears as a string (`"page.title"`), matches a template literal (`case.req.${id}.label`), or extends a literal
 * prefix ending in a dot (`"score.tone." + word`) in a file that reads that namespace; or anywhere, written with
 * the namespace (`"errors:codes.UNKNOWN"`). Plural forms count as their base key. Tests don't count as use.
 *
 * Which namespaces a file reads: every namespace it names as a string (`useTranslation("analyses")`,
 * `getT("legal")`, `TFunction<"upload">`, `{ ns: "upload" }`, `<ClientMessages ns={["analyses"]}>`), the bundle
 * JSON it imports, `common` for a bare `useTranslation()` (the default namespace), and everything the files that
 * import it read, since a module of keys (nav.ts, a schema's messages) is read through its importers' t.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SCOPES = ["app", "screens", "components", "hooks", "lib"];
const PLURAL = /_(?:zero|one|two|few|many|other)$/;
const NAMESPACE_SET: ReadonlySet<string> = new Set(NAMESPACES);
const DEFAULT_NAMESPACE: Namespace = "common";

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") yield* sources(full);
    } else if (/\.tsx?$/.test(name) && !/\.(test|stub)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

// i18next contexts (`{ context: "several" }` reads `alternative_several`).
const CONTEXT = /_[a-z]+$/;
// Read as objects, not through t(): lib/i18n/sentences.ts takes the conjunctions and language names from the bundle.
const STRUCTURAL = ["sentences:conj.", "sentences:languages."];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A template that builds a key: its static text is key-like and has a dotted segment (`${a}${b}` would match all). */
function isKeyTemplate(node: ts.TemplateExpression): boolean {
  const statics = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  return statics.every((text) => /^(?:[A-Za-z]+:)?[\w.-]*$/.test(text)) && statics.some((text) => /[\w-]\.|\.[\w-]/.test(text));
}

/** What a set of files can read: plain key strings, key templates, and prefixes ending in a dot. */
type Reads = { literals: Set<string>; patterns: RegExp[]; prefixes: string[] };
const emptyReads = (): Reads => ({ literals: new Set(), patterns: [], prefixes: [] });

const PREFIX = /^[\w-]+(?:\.[\w-]+)*\.$/;

/** "ns:rest" with a real namespace: the namespace and the rest; anything else is not namespaced. */
function splitNamespace(text: string): { ns: Namespace; rest: string } | null {
  const match = /^([A-Za-z]+):([^]*)$/.exec(text);
  return match && NAMESPACE_SET.has(match[1]) ? { ns: match[1] as Namespace, rest: match[2] } : null;
}

type FileFacts = { reads: Reads; own: Set<Namespace>; imports: string[] };

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function collect(): { files: Map<string, FileFacts>; explicit: Map<Namespace, Reads> } {
  const files = new Map<string, FileFacts>();
  const explicit = new Map<Namespace, Reads>(NAMESPACES.map((ns) => [ns, emptyReads()]));

  for (const scope of SCOPES) {
    for (const file of sources(path.join(ROOT, scope))) {
      const facts: FileFacts = { reads: emptyReads(), own: new Set(), imports: [] };
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);

      const addLiteral = (text: string) => {
        if (NAMESPACE_SET.has(text)) facts.own.add(text as Namespace);
        const named = splitNamespace(text);
        const into = named ? explicit.get(named.ns)! : facts.reads;
        const key = named ? named.rest : text;
        into.literals.add(key);
        if (PREFIX.test(key)) into.prefixes.push(key);
      };
      const addImport = (specifier: string) => {
        const bundle = /^@\/locales\/[a-z]+\/(\w+)\.json$/.exec(specifier);
        if (bundle && NAMESPACE_SET.has(bundle[1])) facts.own.add(bundle[1] as Namespace);
        const resolved = resolveImport(file, specifier);
        if (resolved) facts.imports.push(resolved);
      };

      const visit = (node: ts.Node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          addImport(node.moduleSpecifier.text);
          return;
        }
        if (ts.isCallExpression(node)) {
          const [first] = node.arguments;
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword && first && ts.isStringLiteral(first)) addImport(first.text);
          if (ts.isIdentifier(node.expression) && node.expression.text === "useTranslation" && node.arguments.length === 0) {
            facts.own.add(DEFAULT_NAMESPACE);
          }
        }
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          addLiteral(node.text);
        } else if (ts.isTemplateExpression(node) && isKeyTemplate(node)) {
          const named = splitNamespace(node.head.text);
          const head = named ? named.rest : node.head.text;
          const parts = [escape(head), ...node.templateSpans.map((span) => `.+${escape(span.literal.text)}`)];
          (named ? explicit.get(named.ns)! : facts.reads).patterns.push(new RegExp(`^${parts.join("")}$`));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      files.set(file, facts);
    }
  }
  return { files, explicit };
}

/** Each file's namespaces: its own, and those of every file that imports it, transitively. */
function scopes(files: Map<string, FileFacts>): Map<string, Set<Namespace>> {
  const importers = new Map<string, string[]>();
  for (const [file, facts] of files) {
    for (const imported of facts.imports) importers.set(imported, [...(importers.get(imported) ?? []), file]);
  }
  const result = new Map<string, Set<Namespace>>();
  for (const file of files.keys()) {
    const seen = new Set([file]);
    const queue = [file];
    const namespaces = new Set<Namespace>();
    while (queue.length) {
      const current = queue.pop()!;
      for (const ns of files.get(current)?.own ?? []) namespaces.add(ns);
      for (const importer of importers.get(current) ?? []) {
        if (!seen.has(importer)) {
          seen.add(importer);
          queue.push(importer);
        }
      }
    }
    result.set(file, namespaces);
  }
  return result;
}

/** What each namespace can read: the files whose scope holds it, plus the strings that name it. */
function readsByNamespace(): Map<Namespace, Reads> {
  const { files, explicit } = collect();
  const scoped = scopes(files);
  const byNamespace = new Map<Namespace, Reads>(NAMESPACES.map((ns) => [ns, emptyReads()]));
  for (const ns of NAMESPACES) {
    const into = byNamespace.get(ns)!;
    const merge = (reads: Reads) => {
      for (const literal of reads.literals) into.literals.add(literal);
      into.patterns.push(...reads.patterns);
      into.prefixes.push(...reads.prefixes);
    };
    merge(explicit.get(ns)!);
    for (const [file, facts] of files) if (scoped.get(file)!.has(ns)) merge(facts.reads);
  }
  return byNamespace;
}

function leaves(value: unknown, at: string[] = []): string[] {
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => leaves(child, [...at, key]));
  return [at.join(".")];
}

const bundleOf = (ns: Namespace): unknown => JSON.parse(readFileSync(path.join(ROOT, "locales", "en", `${ns}.json`), "utf8"));

function unusedKeys(reads: Map<Namespace, Reads>, bundle: (ns: Namespace) => unknown = bundleOf): string[] {
  return NAMESPACES.flatMap((ns) => {
    const { literals, patterns, prefixes } = reads.get(ns)!;
    return leaves(bundle(ns))
      .map((key) => key.replace(PLURAL, ""))
      .filter((key, i, all) => all.indexOf(key) === i)
      .filter((key) => !STRUCTURAL.some((prefix) => `${ns}:${key}`.startsWith(prefix)))
      .filter((key) => ![key, key.replace(CONTEXT, "")].some((k) => literals.has(k) || patterns.some((p) => p.test(k)) || prefixes.some((p) => k.startsWith(p))))
      .map((key) => `${ns}:${key}`);
  });
}

describe("locale keys", () => {
  const reads = readsByNamespace();

  it("are all read by some code, through their own namespace", () => {
    expect(unusedKeys(reads)).toEqual([]);
  });

  it("catches a dead key whose name another namespace uses: the check is per namespace", () => {
    // `page.title` is read in analyses (the list's heading) and nowhere through notFound.
    expect(reads.get("analyses")!.literals.has("page.title")).toBe(true);
    const planted = (ns: Namespace) => (ns === "notFound" ? { ...(bundleOf(ns) as object), page: { title: "Planted" } } : bundleOf(ns));
    const before = new Set(unusedKeys(reads));
    expect(unusedKeys(reads, planted).filter((key) => !before.has(key))).toEqual(["notFound:page.title"]);
  });
});
