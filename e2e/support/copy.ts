import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInstance } from "i18next";
import type { TestInfo } from "@playwright/test";
import { BRAND } from "../../lib/brand";

/**
 * The copy the app shows, from the same locale files, in the project's language: the specs assert
 * what a user reads in English and in Spanish without a second copy of any string.
 */

export type SpecLocale = "en" | "es";

const LOCALES_DIR = path.resolve(process.cwd(), "locales");

function resources(locale: SpecLocale) {
  const dir = path.join(LOCALES_DIR, locale);
  return Object.fromEntries(readdirSync(dir).filter((file) => file.endsWith(".json")).map((file) => [file.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(dir, file), "utf8"))]));
}

/** The interface language of the project running the test: its browser locale. */
export function localeOf(testInfo: TestInfo): SpecLocale {
  return String(testInfo.project.use.locale ?? "en").toLowerCase().startsWith("es") ? "es" : "en";
}

/** "account:intro.titleFree", with interpolation values. */
export type Copy = (key: string, options?: Record<string, unknown>) => string;

/** A t function over every namespace (`"account:intro.titleFree"`), in the given language. */
export function copyFor(locale: SpecLocale): Copy {
  const instance = createInstance();
  void instance.init({
    lng: locale,
    resources: { [locale]: resources(locale) },
    defaultNS: "common",
    initAsync: false,
    interpolation: { escapeValue: false, defaultVariables: { brand: BRAND.name } },
  });
  return (key, options) => instance.t(key as never, options as never) as unknown as string;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A literal as a regex; whitespace matches any run of whitespace (innerText reflows). */
export function literal(text: string, flags = ""): RegExp {
  return new RegExp(escape(text).replace(/\s+/g, "\\s+"), flags);
}

/** The text before an interpolated part: "Get Pro · {{price}} a month" → /Get Pro/. */
export function prefix(text: string, flags = "i"): RegExp {
  return literal(text.split(/\s*[·{]/)[0].trim(), flags);
}
