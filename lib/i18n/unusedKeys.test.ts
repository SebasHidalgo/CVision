import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { NAMESPACES } from "./config";

/**
 * Every key in locales/ is read by some code. A key counts as used when its path appears as a string in the
 * interface code, matches a template literal there (`case.req.${id}.label`), or extends a literal prefix ending in
 * a dot (`"score.tone." + word`). Plural forms count as their base key. Tests don't count as use.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SCOPES = ["app", "screens", "components", "hooks", "lib"];
const PLURAL = /_(?:zero|one|two|few|many|other)$/;

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

function collect() {
  const literals = new Set<string>();
  const patterns: RegExp[] = [];
  for (const scope of SCOPES) {
    for (const file of sources(path.join(ROOT, scope))) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          literals.add(node.text.replace(/^[A-Za-z]+:/, ""));
        } else if (ts.isTemplateExpression(node) && isKeyTemplate(node)) {
          const parts = [escape(node.head.text), ...node.templateSpans.map((span) => `.+${escape(span.literal.text)}`)];
          patterns.push(new RegExp(`^${parts.join("").replace(/^[A-Za-z]+:/, "")}$`));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  const prefixes = [...literals].filter((text) => /^[\w-]+(?:\.[\w-]+)*\.$/.test(text));
  return { literals, patterns, prefixes };
}

function leaves(value: unknown, at: string[] = []): string[] {
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => leaves(child, [...at, key]));
  return [at.join(".")];
}

describe("locale keys", () => {
  it("are all read by some code", () => {
    const { literals, patterns, prefixes } = collect();
    const unused = NAMESPACES.flatMap((ns) => {
      const bundle = JSON.parse(readFileSync(path.join(ROOT, "locales", "en", `${ns}.json`), "utf8"));
      return leaves(bundle)
        .map((key) => key.replace(PLURAL, ""))
        .filter((key, i, all) => all.indexOf(key) === i)
        .filter((key) => !STRUCTURAL.some((prefix) => `${ns}:${key}`.startsWith(prefix)))
        .filter((key) => ![key, key.replace(CONTEXT, "")].some((k) => literals.has(k) || patterns.some((p) => p.test(k)) || prefixes.some((p) => k.startsWith(p))))
        .map((key) => `${ns}:${key}`);
    });
    expect(unused).toEqual([]);
  });
});
