import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, NAMESPACES } from "./config";
import { localeFromAcceptLanguage, resolveLocale } from "./resolve";

const ROOT = path.resolve(__dirname, "..", "..");
const PLURAL = /_(zero|one|two|few|many|other)$/;
const VARIABLE = /\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g;

type Leaves = Map<string, string>;

function leaves(tree: unknown, prefix = "", out: Leaves = new Map()): Leaves {
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(at, value);
    else if (value && typeof value === "object") leaves(value, at, out);
    else out.set(at, String(value));
  }
  return out;
}

const read = (locale: string, ns: string): Leaves => leaves(JSON.parse(readFileSync(path.join(ROOT, "locales", locale, `${ns}.json`), "utf8")));
const base = (key: string) => key.replace(PLURAL, "");
const variables = (text: string) => new Set([...text.matchAll(VARIABLE)].map((match) => match[1]).filter((name) => name !== "count"));

describe("locale files", () => {
  it("exist for every namespace and nothing else", () => {
    for (const locale of LOCALES) {
      const files = readdirSync(path.join(ROOT, "locales", locale)).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, ""));
      expect(files.sort()).toEqual([...NAMESPACES].sort());
    }
  });

  it.each(NAMESPACES)("%s: every key in both locales, no empty value", (ns) => {
    const en = read("en", ns);
    const es = read("es", ns);
    const enBases = new Set([...en.keys()].map(base));
    const esBases = new Set([...es.keys()].map(base));
    expect([...enBases].filter((key) => !esBases.has(key)), "missing in es").toEqual([]);
    expect([...esBases].filter((key) => !enBases.has(key)), "only in es").toEqual([]);
    for (const [locale, map] of [["en", en], ["es", es]] as const) {
      const empty = [...map].filter(([, value]) => !value.trim()).map(([key]) => key);
      expect(empty, `empty in ${locale}`).toEqual([]);
    }
  });

  it.each(NAMESPACES)("%s: the same interpolation variables in both locales", (ns) => {
    const collect = (map: Leaves) => {
      const byBase = new Map<string, Set<string>>();
      for (const [key, value] of map) {
        const set = byBase.get(base(key)) ?? new Set<string>();
        for (const name of variables(value)) set.add(name);
        byBase.set(base(key), set);
      }
      return byBase;
    };
    const en = collect(read("en", ns));
    const es = collect(read("es", ns));
    const differing = [...en].filter(([key, names]) => {
      const other = es.get(key);
      return other && [...names].sort().join() !== [...other].sort().join();
    });
    expect(differing.map(([key, names]) => `${key}: en {${[...names]}} es {${[...(es.get(key) ?? [])]}}`)).toEqual([]);
  });

  it.each(NAMESPACES)("%s: plurals carry every form the language uses", (ns) => {
    const required = { en: ["one", "other"], es: ["one", "many", "other"] } as const;
    for (const locale of LOCALES) {
      const keys = [...read(locale, ns).keys()];
      const plurals = new Set(keys.filter((key) => PLURAL.test(key)).map(base));
      const missing = [...plurals].flatMap((key) => required[locale].filter((form) => !keys.includes(`${key}_${form}`)).map((form) => `${key}_${form}`));
      expect(missing, `${locale} plural forms`).toEqual([]);
    }
  });

  it("Spanish addresses the user as tú", () => {
    const USTED = /(?<!\p{L})(?:usted|Usted|Ingrese|Introduzca|Haga clic|Seleccione|Verifique|Suba|Pegue|Elija|Agregue|Escriba|Utilice|Intente|Vuelva a)(?!\p{L})/u;
    const offenders = NAMESPACES.flatMap((ns) => [...read("es", ns)].filter(([, value]) => USTED.test(value)).map(([key, value]) => `${ns}:${key}: ${value}`));
    expect(offenders).toEqual([]);
  });
});

describe("resolveLocale", () => {
  it("prefers the saved choice, then the cookie, then the browser", () => {
    expect(resolveLocale({ saved: "es", cookie: "en", acceptLanguage: "en-US" })).toBe("es");
    expect(resolveLocale({ saved: null, cookie: "es", acceptLanguage: "en-US" })).toBe("es");
    expect(resolveLocale({ saved: null, cookie: undefined, acceptLanguage: "es-MX,es;q=0.9" })).toBe("es");
    expect(resolveLocale({ saved: null, cookie: null, acceptLanguage: null })).toBe("en");
  });

  it("ignores values it does not know instead of trusting them", () => {
    expect(resolveLocale({ saved: "fr", cookie: "<script>", acceptLanguage: "es" })).toBe("es");
  });

  it("reads any es* as Spanish and anything else as English, by rank", () => {
    expect(localeFromAcceptLanguage("es-AR")).toBe("es");
    expect(localeFromAcceptLanguage("ES")).toBe("es");
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,es;q=0.8,en;q=0.7")).toBe("es");
    expect(localeFromAcceptLanguage("fr-FR,en;q=0.8,es;q=0.7")).toBe("en");
    expect(localeFromAcceptLanguage("es;q=0.5,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("de-DE")).toBe("en");
    expect(localeFromAcceptLanguage("es;q=0")).toBe("en");
    expect(localeFromAcceptLanguage("*")).toBe("en");
  });
});
