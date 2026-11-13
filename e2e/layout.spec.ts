import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { openRoom } from "./support/app";
import { copyFor, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";
import { layoutViolations, openDetails, settle, type LayoutViolation } from "./support/layout";
import { seedAnalysis, seedCompletedInterview, setUsage } from "./support/seed";

/**
 * The main pages from a phone to a wide desktop, once per interface language: no sideways scroll, no
 * text over or under a button, a card, an illustration or other text, no text leaving its block, no
 * button that clips its text, no text cut short with an ellipsis outside the allowlist. Every <details> is opened
 * first. One seeded analysis (no model call for it; in Spanish, its translation on first view), its room before
 * Start and again with the trial used (the Pro offer), the room live with an invented 24-line call (the dev-only
 * preview route), and a finished Spanish interview's feedback page with its transcript (seeded, no call).
 */

// One test per width, each on its own account: they run in parallel workers.
test.describe.configure({ mode: "parallel" });
test.setTimeout(600_000);

const WIDTHS = [375, 768, 1024, 1280, 1366, 1440, 1920] as const;
const HEIGHT: Record<(typeof WIDTHS)[number], number> = { 375: 812, 768: 1024, 1024: 768, 1280: 900, 1366: 768, 1440: 900, 1920: 1080 };

test.beforeAll(() => assertSandbox());

async function check(page: import("@playwright/test").Page, urls: Array<[string, string]>, found: LayoutViolation[]) {
  for (const [label, url] of urls) {
    await page.goto(url);
    await settle(page);
    await openDetails(page);
    found.push(...(await layoutViolations(page, label)));
  }
}

test("the checks catch what they look for", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // The M9 bug's shape (a nowrap label pushed over its paragraph), a clipped label, a too-wide block, a line leaving its column.
  await page.setContent(`<body style="margin:0;font:16px sans-serif">
    <section style="display:grid;grid-template-columns:1fr 120px;gap:8px;width:360px">
      <p style="margin:0">Un entrevistador de IA por voz te hace las preguntas de esta oferta.</p>
      <div style="justify-self:end"><button style="white-space:nowrap">Prueba de entrevista de 5 minutos, gratis</button></div>
    </section>
    <button style="width:60px;overflow:hidden;white-space:nowrap">Empezar la entrevista</button>
    <div style="width:600px">wide</div>
    <p style="width:100px;white-space:nowrap">Una línea que no entra en su columna</p>
    <p style="width:70px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Entrevistador</p>
    <p data-truncate="file-name" style="width:70px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">curriculum-final-v3.pdf</p>
  </body>`);
  const seen = await layoutViolations(page, "self-test");
  const kinds = seen.map((violation) => violation.kind).sort();
  expect(kinds).toEqual(["clipped", "horizontal-scroll", "overflow", "overlap", "truncated"]);
  expect(seen.find((violation) => violation.kind === "truncated")?.detail).toContain("Entrevistador");
});

test("the checks catch a scroll box whose last line ends under a sticky footer, and pass one that ends above it", async ({ page }) => {
  // The M10-C room: a transcript box taller than the room left it, its end behind the sticky control bar.
  const room = (boxHeight: number) => `<body style="margin:0;font:16px sans-serif">
    <div style="display:flex;flex-direction:column;min-height:100vh">
      <h1 style="margin:16px">Interview room</h1>
      <div role="log" style="height:${boxHeight}px;overflow-y:auto;margin:0 16px">
        ${Array.from({ length: 30 }, (_, i) => `<p style="margin:0 0 12px">Line ${i + 1} of the conversation, said in the call.</p>`).join("")}
      </div>
      <footer style="position:sticky;bottom:0;margin-top:auto;height:80px;background:#eee"><button>End the interview</button></footer>
    </div>
  </body>`;
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.setContent(room(650));
  const broken = await layoutViolations(page, "room");
  expect(broken.filter((violation) => violation.kind === "covered").map((violation) => violation.detail).join(" | ")).toContain("Line 30");
  await page.setContent(room(500));
  expect((await layoutViolations(page, "room")).filter((violation) => violation.kind === "covered")).toEqual([]);
});

test("the checks catch a heading that runs behind the illustration beside it", async ({ page }) => {
  // The M9-B hero: a nowrap phrase wider than its column, sliding under the card in the next one.
  const hero = (phrase: string) => `<body style="margin:0;font:16px sans-serif">
    <section style="display:grid;grid-template-columns:7fr 5fr;gap:40px;width:1000px;align-items:center">
      <div style="min-width:0"><h1 style="margin:0;font-size:90px;line-height:0.96">¿Tu CV ${phrase} con el puesto?</h1></div>
      <figure style="margin:0"><div style="background:#fff;box-shadow:0 2px 8px #0003;height:420px;padding:24px">Compatibilidad alta</div></figure>
    </section>
    <details><summary>Evidencia</summary><ul><li>Una línea que no se dibuja</li><li>Otra línea que no se dibuja</li></ul></details>
    <p style="margin:0">El texto que sigue a un bloque cerrado.</p>
  </body>`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(hero(`<span style="display:inline-block;white-space:nowrap">encaja de verdad</span>`));
  const broken = await layoutViolations(page, "hero");
  expect(broken.map((violation) => violation.kind).sort()).toEqual(["overflow", "overlap"]);
  expect(broken.find((violation) => violation.kind === "overlap")?.detail).toContain("Compatibilidad alta");

  // The same words free to wrap, text on its own card, a closed details block: nothing to report.
  await page.setContent(hero(`<span style="display:inline-block">encaja</span> <span style="display:inline-block">de</span> <span style="display:inline-block">verdad</span>`));
  expect(await layoutViolations(page, "hero")).toEqual([]);
});

test("settling fails fast on a page that keeps reloading itself", async ({ page }) => {
  // A dev-server reload loop's shape: the page never stays loaded, so the network is never idle.
  await page.route("http://reload-loop.test/", (route) => route.fulfill({ contentType: "text/html", body: "<p>Loading</p><script>setTimeout(() => location.reload(), 300)</script>" }));
  await page.goto("http://reload-loop.test/");
  const startedAt = Date.now();
  await expect(settle(page, { idleTimeoutMs: 5_000 })).rejects.toThrow(/reloaded itself \d+ times/);
  expect(Date.now() - startedAt).toBeLessThan(10_000);
});

for (const width of WIDTHS) {
  test(`the main pages hold their layout at ${width} px`, async ({ page }, testInfo) => {
    const t = copyFor(localeOf(testInfo));
    await page.setViewportSize({ width, height: HEIGHT[width] });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const found: LayoutViolation[] = [];

    await check(page, [["landing", "/"], ["pricing", "/pricing"], ["terms", "/terms"]], found);

    const account: TestAccount = await createAccount(`layout-${width}-${localeOf(testInfo)}`);
    try {
      await signIn(page, account);
      const analysisId = await seedAnalysis(account);
      await page.goto(`/resume/analysis/${analysisId}`);
      await settle(page);
      const room = new URL(await openRoom(page, t)).pathname;
      const feedback = `/interview/${await seedCompletedInterview(account, analysisId)}/feedback`;

      await check(
        page,
        [
          ["upload", "/resume/upload"],
          ["analyses", "/resume/analyses"],
          ["analysis", `/resume/analysis/${analysisId}`],
          ["interview room", room],
          ["interview room, live (24 lines)", "/dev/room-preview"],
          ["interview room, time up and closing", "/dev/room-preview?closing=1"],
          ["interview feedback (Spanish transcript)", feedback],
          ["interviews", "/interviews"],
          ["account and billing", "/account/billing"],
          ["pricing (signed in)", "/pricing"],
        ],
        found,
      );

      // The same room once the trial is used: the Pro offer in place of Start.
      await setUsage(account, { trialUsed: true });
      await check(page, [["interview room, Pro offer", room]], found);
    } finally {
      await deleteAccount(account);
    }

    for (const violation of found) console.log(`[layout] ${violation.page} @${violation.width}: ${violation.kind} — ${violation.detail}`);
    await testInfo.attach("layout-violations.json", { body: JSON.stringify(found, null, 2), contentType: "application/json" });
    expect(found).toEqual([]);
  });
}
