import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every user-facing string lives in locales/. This walks the AST of the interface code and fails on
 * text a user would read: JSX text, prose in JSX attributes and children, toast messages, and
 * sentences in copy modules. Brand and product names are allowed; anything else is a key.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SCOPES = ["app", "screens", "components", "hooks"];
const SKIP_DIRS = new Set(["ui", "node_modules"]);
// Modules outside the scopes that hold interface copy.
const COPY_MODULES = ["lib/score.ts", "lib/legal.ts", "lib/plans.ts", "lib/interviewStatus.ts", "lib/error/actionErrorCopy.ts", "lib/i18n/tally.ts"];

/** Text that is a name, a symbol or a figure in every language. */
const ALLOWED_TEXT = new Set(["CV", "PDF", "ATS", "Pro", "EN", "ES", "LinkedIn", "Word", "Google Docs", "Canva", "Paddle", "Clerk", "ElevenLabs", "Gemini"]);

/** JSX attributes whose values are never read by a person. */
const TECHNICAL_ATTRS = new Set([
  "className", "class", "style", "href", "src", "srcSet", "id", "key", "type", "variant", "size", "rel", "target", "role", "name", "htmlFor",
  "method", "action", "mode", "side", "align", "as", "lang", "dir", "autoComplete", "inputMode", "accept", "tone", "wording", "reveal",
  "forceRedirectUrl", "redirectUrl", "sizes", "d", "viewBox", "fill", "stroke", "xmlns", "strokeWidth", "strokeLinecap", "strokeLinejoin",
  "ns", "i18nKey", "aria-hidden", "aria-current", "aria-live", "aria-labelledby", "aria-describedby", "aria-controls", "aria-haspopup",
  "aria-expanded", "aria-pressed", "aria-busy", "aria-atomic", "aria-modal", "aria-orientation", "pattern", "encType", "loading", "decoding",
  "fetchPriority", "prefetch", "scroll", "replace", "sandbox", "allow", "referrerPolicy", "crossOrigin", "media", "content", "property",
  "charSet", "httpEquiv", "itemProp", "position", "orientation", "defaultValue", "value", "form", "formAction", "variantName", "item",
  "variantKey", "dataset", "testId", "data-testid", "tabIndex", "colSpan", "rowSpan", "scope", "headers", "wrap", "autoCapitalize",
  "enterKeyHint", "spellCheck", "translate", "color", "from", "to", "ease", "transition", "layout", "layoutId", "initial", "animate", "exit",
  "storageKey", "attribute", "defaultTheme", "anchor", "returnTo", "kind", "status", "source", "phase", "reason", "code", "plan", "tier",
]);

const HAS_LETTER = /\p{L}/u;
// Words joined by spaces, or a capitalized word: prose, not a token like "outline" or "nav.home".
const PROSE = /\p{L}{2,}[^\n]*\s\p{L}{2,}|^\p{Lu}\p{Ll}+/u;
const KEY_LIKE = /^[\w-]+(?:[.:][\w-]+)+$/;
const CSS_LIKE = /^[\w\-:/[\]().%#!&>*=,'" ]+$/;

/** Text whose every word is an allowed name ("· CV", "PDF"): the same in every language. */
const onlyNames = (text: string) => {
  const trimmed = text.trim();
  if (ALLOWED_TEXT.has(trimmed)) return true;
  const words = trimmed.split(/[^\p{L}]+/u).filter(Boolean);
  return words.length > 0 && words.every((word) => ALLOWED_TEXT.has(word));
};

function* files(target: string): Generator<string> {
  const full = path.join(ROOT, target);
  if (statSync(full).isFile()) {
    yield full;
    return;
  }
  for (const name of readdirSync(full)) {
    const child = path.join(full, name);
    if (statSync(child).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* files(path.relative(ROOT, child));
    } else if (/\.tsx?$/.test(name) && !/\.(test|stub)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) yield child;
  }
}

const looksLikeCss = (text: string) => CSS_LIKE.test(text) && !/[A-Z]/.test(text) && /(?:^|\s)[\w-]+-[\w-]+/.test(text);
const isProse = (text: string) => {
  const trimmed = text.trim();
  if (!HAS_LETTER.test(trimmed) || onlyNames(trimmed) || KEY_LIKE.test(trimmed) || trimmed.startsWith("/") || /^https?:/.test(trimmed)) return false;
  if (looksLikeCss(trimmed)) return false;
  return PROSE.test(trimmed);
};

/** The JSX attribute a node is the value of, if any. */
function attributeOf(node: ts.Node): ts.JsxAttribute | null {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isJsxAttribute(at)) return at;
    if (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at) || ts.isCallExpression(at) || ts.isFunctionLike(at)) return null;
  }
  return null;
}

/** Whether a literal sits in a JSX child expression, outside any call: rendered as text. */
function renderedAsChild(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    // A comparison against a literal (`x === "y"`, `x !== "y"`) is a value, not rendered text.
    const comparison =
      ts.isBinaryExpression(at) &&
      [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(at.operatorToken.kind);
    if (ts.isCallExpression(at) || ts.isFunctionLike(at) || ts.isJsxAttribute(at) || ts.isPropertyAssignment(at) || ts.isElementAccessExpression(at) || comparison) return false;
    if (ts.isJsxExpression(at)) return !!at.parent && (ts.isJsxElement(at.parent) || ts.isJsxFragment(at.parent));
  }
  return false;
}

const TOAST = /^(?:toast(?:\.\w+)?|setProblem|setError|setMessage|confirm|alert)$/;

function textOf(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression): string {
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
  return node.text;
}

function offenders(file: string, copyModule: boolean): string[] {
  return scan(readFileSync(file, "utf8"), file, copyModule);
}

function scan(text: string, file: string, copyModule: boolean): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const where = (node: ts.Node, text: string) => `${path.relative(ROOT, file).split(path.sep).join("/")}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} "${text.trim().slice(0, 60)}"`;

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (text && HAS_LETTER.test(text) && !onlyNames(text)) found.push(where(node, text));
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const text = textOf(node);
      if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || ts.isLiteralTypeNode(node.parent) || (ts.isExpressionStatement(node.parent) && /^use (client|server)$/.test(text))) {
        // Module specifiers, directives and types are not copy.
      } else {
        const attribute = attributeOf(node);
        const call = ts.isCallExpression(node.parent) ? node.parent.expression.getText(source) : null;
        if (attribute) {
          const name = attribute.name.getText(source);
          if (!TECHNICAL_ATTRS.has(name) && !name.startsWith("data-") && isProse(text)) found.push(where(node, text));
        } else if (call && TOAST.test(call) && isProse(text)) {
          found.push(where(node, text));
        } else if (renderedAsChild(node) && HAS_LETTER.test(text) && !onlyNames(text)) {
          found.push(where(node, text));
        } else if (
          copyModule &&
          isProse(text) &&
          !ts.isNewExpression(node.parent) &&
          !(call && /^(?:t|i18n\.t|translate|cn|clsx|console\.\w+|fail|warn|toActionError|handleError)$/.test(call))
        ) {
          found.push(where(node, text));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("user-facing strings", () => {
  it("catches each kind of hard-coded copy, and leaves keys, classes and names alone", () => {
    const tsx = [
      'const A = () => <p className="mt-2 text-ink">Hello there</p>;',
      'const B = () => <Button aria-label="Close the drawer" variant="ghost" />;',
      'const C = ({ on }: { on: boolean }) => <span>{on ? "Turned on" : t("off")}</span>;',
      'const D = () => { toast.error("Something failed"); return <p>{t("ok")} · CV</p>; };',
      'const E = ({ x }: { x: string }) => <p>{x !== "none" && t("x")}</p>;',
    ].join("\n");
    const found = scan(tsx, ROOT + "/screens/X/X.tsx", false).map((line) => line.replace(/^.*?"/, "\""));
    expect(found).toEqual(['"Hello there"', '"Close the drawer"', '"Turned on"', '"Something failed"']);
    expect(scan('export const LABEL = { title: "Open the room" }; export const KEY = "nav.home";', ROOT + "/screens/X/utils/copy.ts", true)).toHaveLength(1);
  });

  it("live in locales/, not in JSX or copy modules", () => {
    const found = [
      // Actions return codes, never copy: their strings are log context and error names.
      ...SCOPES.flatMap((scope) =>
        [...files(scope)].flatMap((file) => offenders(file, !file.endsWith(".tsx") && !/[\\/]actions[\\/]/.test(file) && /[\\/](?:utils|components|hooks)[\\/]/.test(file))),
      ),
      ...COPY_MODULES.flatMap((file) => offenders(path.join(ROOT, file), true)),
    ];
    expect(found).toEqual([]);
  });
});
