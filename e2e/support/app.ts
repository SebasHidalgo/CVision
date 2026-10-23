import { readFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { BASE_URL } from "./env";

/**
 * The app as the specs drive it: an analysis from the eval fixture, the
 * interview CTA and the room before any Start, the account page's text.
 * Nothing here pays or calls anyone; the specs decide that.
 */

export const FIXTURE_DIR = path.resolve(process.cwd(), "scripts", "eval", "fixtures", "tech-frontend-match");

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The page's main text, whitespace collapsed, for assertions on copy. */
export async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").first().innerText()).replace(/\s+/g, " ").trim();
}

/** The fixture's CV as a one-page PDF, rendered by the browser itself. */
export async function cvPdf(page: Page): Promise<Buffer> {
  const cv = readFileSync(path.join(FIXTURE_DIR, "cv.txt"), "utf8");
  const scratch = await page.context().newPage();
  await scratch.setContent(`<html><body style="font-family: Georgia, serif; font-size: 12px; white-space: pre-wrap; padding: 40px;">${escapeHtml(cv)}</body></html>`);
  const pdf = await scratch.pdf({ format: "A4" });
  await scratch.close();
  return pdf;
}

/** Runs one analysis of the fixture (one paid model call) and returns the analysis page's URL. */
export async function runAnalysis(page: Page): Promise<string> {
  const job = readFileSync(path.join(FIXTURE_DIR, "job.txt"), "utf8");
  const fixture = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "fixture.json"), "utf8")) as { jobTitle: string };
  const pdf = await cvPdf(page);

  await page.goto("/resume/upload");
  await page.locator("#company-name").fill("Northwind Labs");
  await page.locator("#job-title").fill(fixture.jobTitle);
  await page.locator("#job-description").fill(job);
  await page.locator("input#resume").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/resume\/analysis\/[^/?]+$/, { timeout: 120_000 });
  await page.waitForLoadState("networkidle");
  return page.url();
}

/** The interview call to action on an analysis page. */
export function interviewCta(page: Page): Locator {
  return page.locator('[aria-labelledby="interview-cta-title"]').first();
}

/** From an analysis page into its room, stopping before Start. Returns the room's URL. */
export async function openRoom(page: Page): Promise<string> {
  const cta = interviewCta(page);
  const button = cta.getByRole("button").first();
  if (await button.isVisible({ timeout: 2_000 }).catch(() => false)) await button.click();
  else await cta.getByRole("link", { name: /open the interview room/i }).first().click();
  await page.waitForURL(/\/interview\/[^/?]+$/, { timeout: 60_000 });
  await page.getByRole("button", { name: /start the interview/i }).waitFor({ timeout: 30_000 });
  return page.url();
}

/** The clock the room shows before Start ("12:00", "5:00"). */
export async function roomLength(page: Page): Promise<string> {
  return ((await page.getByLabel("Interview length").textContent()) ?? "").trim();
}

/** The account page's text after a fresh load. */
export async function accountText(page: Page): Promise<string> {
  await page.goto("/account/billing");
  await page.getByRole("heading", { name: /You're on/ }).waitFor({ timeout: 30_000 });
  return mainText(page);
}

/** Reloads the account page until its text satisfies `predicate`, for a change a webhook has to land. */
export async function waitForAccount(page: Page, predicate: (text: string) => boolean, { timeoutMs = 150_000, everyMs = 5_000 } = {}): Promise<string> {
  const until = Date.now() + timeoutMs;
  let text = await accountText(page);
  while (!predicate(text)) {
    if (Date.now() > until) throw new Error(`the account page never showed what was expected within ${timeoutMs / 1000} s; last text: ${text.slice(0, 400)}`);
    await page.waitForTimeout(everyMs);
    text = await accountText(page);
  }
  return text;
}

/**
 * Compiles the routes a webhook hits before any provider calls them: a
 * cold Turbopack route can take longer than Paddle's 5-second signature
 * window, which loses the first delivery (the sandbox retries only twice).
 */
export async function warmRoutes(): Promise<void> {
  for (const route of ["/api/webhooks/paddle", "/api/webhooks/clerk", "/api/webhooks/elevenlabs"]) {
    await fetch(`${BASE_URL}${route}`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(120_000) }).catch(() => {});
  }
  for (const route of ["/pricing", "/account/billing"]) {
    await fetch(`${BASE_URL}${route}`, { signal: AbortSignal.timeout(120_000), redirect: "manual" }).catch(() => {});
  }
}
