import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { accountText, mainText, openRoom, runAnalysis, warmRoutes } from "./support/app";
import { db } from "./support/db";
import { assertSandbox, required } from "./support/env";

/**
 * One real Start, opt-in (`npm run e2e:voice`): it may spend seconds of
 * platform time, and prints what it cost. A fresh Free account presses
 * Start on its trial with fake media devices; the run then follows
 * whichever of the three honest outcomes the platform produces:
 *
 * - refused: the balance is below the floor, the server answers
 *   VOICE_UNAVAILABLE before reserving anything, the room says so, and
 *   the trial is untouched;
 * - failed: the platform issued the token but could not run the call (no
 *   credits); the room goes to the feedback page, the early reconcile
 *   stores CALL_FAILED, the trial and the start are given back;
 * - live: the interviewer joined; the spec ends the call after three
 *   seconds, which leaves a silent attempt (the trial given back) and a
 *   conversation whose cost is read from the platform and printed.
 */

test.setTimeout(600_000);

let account: TestAccount;

test.beforeAll(async () => {
  assertSandbox();
  await warmRoutes();
  account = await createAccount("voice");
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
  await db.$disconnect();
});

type Outcome = "refused" | "live" | "ended";

async function awaitOutcome(page: Parameters<typeof signIn>[0], timeoutMs: number): Promise<Outcome> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (/\/feedback/.test(page.url())) return "ended";
    if (await page.getByRole("button", { name: /end the interview/i }).isVisible({ timeout: 100 }).catch(() => false)) return "live";
    const status = await page.getByRole("status").first().textContent({ timeout: 100 }).catch(() => "");
    if (/temporarily unavailable/.test(status ?? "")) return "refused";
    await page.waitForTimeout(500);
  }
  throw new Error("the room neither went live, nor refused, nor ended within the wait");
}

test("one start on the trial: refused before any charge, failed by the platform and given back, or live and ended at once", async ({ page }) => {
  await signIn(page, account);
  await runAnalysis(page);
  await openRoom(page);
  const startedAt = Date.now();
  await page.getByRole("button", { name: /start the interview/i }).click();

  let outcome = await awaitOutcome(page, 90_000);
  console.log(`[e2e voice] outcome after ${Math.round((Date.now() - startedAt) / 1000)} s: ${outcome}`);

  if (outcome === "refused") {
    const status = (await page.getByRole("status").first().textContent()) ?? "";
    expect(status).toContain("Voice interviews are temporarily unavailable. Nothing was charged.");
    await expect(page.getByRole("button", { name: /start the interview/i })).toBeEnabled();
    const text = await accountText(page);
    expect(text).toContain("One free 5-minute practice interview.");
    expect(text).not.toContain("pending return");
    const row = await db.interview.findFirst({ where: { userId: account.id }, orderBy: { createdAt: "desc" } });
    expect(row?.startCount ?? 0).toBe(0);
    expect(row?.usageEventId ?? null).toBeNull();
    console.log("[e2e voice] cost: nothing; the balance floor refused the start before a token was issued (real call blocked on credits)");
    return;
  }

  if (outcome === "live") {
    // The call may be over before the click lands (the platform drops a
    // call it cannot run a moment after connecting): a short, tolerant
    // click, then the navigation either way.
    await page.waitForTimeout(3_000);
    await page
      .getByRole("button", { name: /end the interview/i })
      .click({ timeout: 5_000 })
      .catch(() => console.log("[e2e voice] the call ended on its own before End was clicked"));
    await page.waitForURL(/\/feedback/, { timeout: 60_000 });
    outcome = "ended";
  }

  // The feedback page settles once the platform's record is in: within
  // seconds for a call the platform failed (the early reconcile), within
  // about a minute for a call that ran (the webhook).
  const settled = await expect
    .poll(async () => {
      const text = await mainText(page).catch(() => "");
      if (/couldn't join the call/.test(text)) return "failed";
      if (/never heard you/.test(text)) return "silent";
      if (/Interview feedback/.test(text) && /score/i.test(text)) return "scored";
      return "pending";
    }, { timeout: 180_000, intervals: [2_000, 5_000] })
    .not.toBe("pending")
    .then(async () => mainText(page));

  const row = await db.interview.findFirst({ where: { userId: account.id }, orderBy: { createdAt: "desc" } });
  console.log(`[e2e voice] interview ${row?.id}: status=${row?.status} failureReason=${row?.failureReason} startCount=${row?.startCount} usageEventId=${row?.usageEventId} conversation=${row?.conversationId}`);

  if (/couldn't join the call/.test(settled)) {
    expect(settled).toContain("Nothing was charged, and this didn't use one of your starts.");
    expect(row?.failureReason).toBe("CALL_FAILED");
    expect(row?.startCount).toBe(0);
    expect(row?.usageEventId).toBeNull();
  } else {
    expect(row?.failureReason === "NO_CANDIDATE_TURNS" || row?.status === "COMPLETED" || row?.status === "FEEDBACK_PENDING" || row?.status === "GENERATING").toBe(true);
  }

  if (row?.conversationId) {
    const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${row.conversationId}`, {
      headers: { "xi-api-key": required("ELEVENLABS_API_KEY") },
      signal: AbortSignal.timeout(20_000),
    });
    const record = (await response.json().catch(() => null)) as { status?: string; metadata?: { call_duration_secs?: number; cost?: number; cost_fiat?: number; error?: { reason?: string } } } | null;
    const cost = record?.metadata?.cost;
    console.log(
      `[e2e voice] platform: status=${record?.status} duration=${record?.metadata?.call_duration_secs ?? "?"} s cost=${typeof cost === "number" ? `${cost} credits (~$${record?.metadata?.cost_fiat?.toFixed(4) ?? "?"})` : "none recorded (a call that never ran is not charged)"}${record?.metadata?.error?.reason ? ` error="${record.metadata.error.reason.slice(0, 120)}"` : ""}`,
    );
  }

  // Whatever happened, the trial was not spent: no answer was ever heard.
  const text = await waitForAccountTrial(page);
  expect(text).toContain("One free 5-minute practice interview.");
  expect(text).not.toContain("pending return");
});

async function waitForAccountTrial(page: Parameters<typeof signIn>[0]): Promise<string> {
  const until = Date.now() + 150_000;
  let text = await accountText(page);
  while (!/One free 5-minute practice interview\./.test(text) && Date.now() < until) {
    await page.waitForTimeout(5_000);
    text = await accountText(page);
  }
  return text;
}
