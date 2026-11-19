import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy } from "./securityHeaders";
import { CLERK_JS_VERSION, clerkAppearance } from "./clerkAppearance";

vi.mock("next/font/google", () => ({ Host_Grotesk: () => ({ variable: "font", style: { fontFamily: "font" } }) }));

const SOURCE = readFileSync(path.join(__dirname, "clerkAppearance.ts"), "utf8");
const KEY = `pk_test_${Buffer.from("thankful-roughy-3.clerk.accounts.dev$").toString("base64")}`;

const major = (version: string) => Number(/^\D*(\d+)/.exec(version)?.[1]);
const installed = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "node_modules", name, "package.json"), "utf8"));

describe("the clerk-js pin", () => {
  it("is an exact release, not a range or a tag the CDN resolves at runtime", () => {
    expect(CLERK_JS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the release the appearance says it was written against", () => {
    const documented = [...SOURCE.matchAll(/clerk-js (\d+\.\d+\.\d+)/g)].map((match) => match[1]);
    expect(documented.length).toBeGreaterThan(0);
    expect(new Set(documented)).toEqual(new Set([CLERK_JS_VERSION]));
  });

  it("is the major the installed @clerk/nextjs loads: clerk-react 5 talks to clerk-js 5", () => {
    expect(major(CLERK_JS_VERSION)).toBe(major(installed("@clerk/clerk-react").version));
    expect(major(installed("@clerk/nextjs").dependencies["@clerk/clerk-react"])).toBe(major(CLERK_JS_VERSION));
  });

  it("loads from the instance's Frontend API, which the CSP allows as a script source", () => {
    // Clerk's own URL shape (clerkJsScriptUrl in @clerk/shared) for a pinned version and no proxy.
    const script = new URL(`https://thankful-roughy-3.clerk.accounts.dev/npm/@clerk/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js`);
    for (const NODE_ENV of ["production", "development"]) {
      const scriptSrc = contentSecurityPolicy({ NODE_ENV, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY }).split("; ").find((part) => part.startsWith("script-src "));
      expect(scriptSrc?.split(" ")).toContain(script.origin);
    }
  });
});

describe("the appearance's focus ring", () => {
  it("is the design system's: 2 px of ink, 3 px off the element", () => {
    const rings = [clerkAppearance.elements.button["&:focus-visible"], clerkAppearance.elements.formFieldInputShowPasswordButton["&:focus-visible"], clerkAppearance.elements.footerActionLink["&:focus-visible"]];
    for (const ring of rings) expect(ring).toEqual({ outline: "2px solid #ededea", outlineOffset: "3px" });
  });
});
