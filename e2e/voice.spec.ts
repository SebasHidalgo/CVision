import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { accountText, mainText, openRoom, warmRoutes } from "./support/app";
import { db } from "./support/db";
import { copyFor } from "./support/copy";
import { assertSandbox } from "./support/env";
import { seedAnalysis } from "./support/seed";
import { readConversationCost, readConversationTurns } from "@/lib/voice/admin";
import { UP_TEXT } from "@/lib/voice/timeNotes";

// The interface stays in English; the call is switched to Spanish in the room, to price the Spanish voice.
const t = copyFor("en");
const TRIAL_AVAILABLE = t("account:trial.availableNote", { minutes: 5 });

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
 * - live: the interviewer joined, speaking Spanish (chosen in the room).
 *   Through the room's dev hooks the spec sends the time-up line and one
 *   typed candidate line, so the interviewer asks the room to end the call
 *   minutes before the room's clock allows it: the tool call must reach the
 *   room over WebRTC and be refused. The spec ends the call under three
 *   seconds after it connected, whatever it saw, and prints what the room
 *   logged, what the platform recorded of the tool, and what the call cost.
 *   The typed line is a candidate turn, so the interview counts: End closes
 *   it and its feedback is generated (one model call, on the ledger).
 */

/** The longest the live call is left running after the room shows it connected. */
const LIVE_CAP_MS = 2_600;

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
  // A seeded analysis: this spec is about the call, not the model.
  await page.goto(`/resume/analysis/${await seedAnalysis(account)}`);
  await openRoom(page, t);
  // An English posting, a Spanish call: the choice in the room decides, not the posting.
  await page.getByLabel("Interview language").selectOption("es");
  // What the room says about the interviewer's tool, with when it said it.
  const roomLog: { at: number; text: string }[] = [];
  page.on("console", (message) => {
    if (message.text().includes("[CVision][room]")) roomLog.push({ at: Date.now(), text: message.text() });
  });
  const startedAt = Date.now();
  await page.getByRole("button", { name: /start the interview/i }).click();

  let outcome = await awaitOutcome(page, 90_000);
  console.log(`[e2e voice] outcome after ${Math.round((Date.now() - startedAt) / 1000)} s: ${outcome}`);

  if (outcome === "refused") {
    const status = (await page.getByRole("status").first().textContent()) ?? "";
    expect(status).toContain("Voice interviews are temporarily unavailable. Nothing was charged.");
    await expect(page.getByRole("button", { name: /start the interview/i })).toBeEnabled();
    const text = await accountText(page, t);
    expect(text).toContain(TRIAL_AVAILABLE);
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
    const liveAt = Date.now();
    // The time-up line, then a candidate line: the interviewer's next turn is the goodbye with end_interview.
    const hooked = await page.evaluate(
      ({ note, line }) => {
        const room = (window as unknown as { __cvisionRoom?: { note: (text: string) => void; say: (text: string) => void } }).__cvisionRoom;
        room?.note(note);
        room?.say(line);
        return Boolean(room);
      },
      { note: UP_TEXT, line: "No tengo nada más que agregar." },
    );
    console.log(`[e2e voice] dev hooks ${hooked ? "sent the time-up line and a typed candidate line" : "are not on this server (ALLOW_DEV_TOOLS): the tool was not exercised"}`);
    // Until the room has answered the tool and the interviewer has had a moment to go on, or the cap.
    while (Date.now() - liveAt < LIVE_CAP_MS) {
      const answered = roomLog.find((entry) => /end_interview reason=/.test(entry.text));
      if (answered && Date.now() - answered.at > 1_000) break;
      await page.waitForTimeout(100);
    }
    const lines = await page.getByRole("log").innerText({ timeout: 1_000 }).catch(() => "");
    const ended = await page
      .getByRole("button", { name: /end the interview/i })
      .click({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    console.log(`[e2e voice] live for ${Date.now() - liveAt} ms after the room showed it connected`);
    for (const entry of roomLog) console.log(`[e2e voice] room +${entry.at - liveAt} ms: ${entry.text}`);
    if (!roomLog.some((entry) => /end_interview reason=/.test(entry.text))) console.log("[e2e voice] the interviewer's tool call did not reach the room inside the cap");
    // An invented account and posting: the lines are the interviewer's, cut short.
    console.log(`[e2e voice] the room's transcript: ${lines.split("\n").filter(Boolean).map((line) => line.slice(0, 90)).join(" | ")}`);
    if (!ended && !/\/feedback/.test(page.url())) {
      // End could not be pressed and the call may still be live: leaving the page hangs up.
      console.log("[e2e voice] End could not be clicked: leaving the room to end the call");
      await page.goto("/");
    } else {
      await page.waitForURL(/\/feedback/, { timeout: 60_000 });
    }
    outcome = "ended";
    await printPlatformTimeline();
    const live = await db.interview.findFirst({ where: { userId: account.id }, orderBy: { createdAt: "desc" }, select: { conversationId: true } });
    if (live?.conversationId) await printToolTurns(live.conversationId);
  }

  // The row settles once the platform's record is in: within seconds for a
  // call the platform failed (the early reconcile), within about a minute
  // for a call that ran (the webhook), then its feedback when it counted.
  const state = async () => {
    const found = await db.interview.findFirst({ where: { userId: account.id }, orderBy: { createdAt: "desc" } });
    if (found?.status === "COMPLETED" || found?.status === "FAILED") return found.status;
    return found?.failureReason ?? "pending";
  };
  await expect.poll(state, { timeout: 180_000, intervals: [2_000, 5_000] }).not.toBe("pending");

  const row = await db.interview.findFirst({ where: { userId: account.id }, orderBy: { createdAt: "desc" } });
  console.log(`[e2e voice] interview ${row?.id}: status=${row?.status} failureReason=${row?.failureReason} startCount=${row?.startCount} usageEventId=${row?.usageEventId} conversation=${row?.conversationId} language=${row?.language} record from=${row?.transcriptSource} callEnd=${JSON.stringify(row?.callEnd)} stored turns=${Array.isArray(row?.transcript) ? row.transcript.length : "?"}`);
  expect(row?.language).toBe("es");

  if (row?.failureReason === "CALL_FAILED") {
    await page.goto(`/interview/${row.id}/feedback`);
    expect(await mainText(page)).toContain("Nothing was charged, and this didn't use one of your starts.");
    expect(row.startCount).toBe(0);
    expect(row.usageEventId).toBeNull();
  } else {
    expect(row?.failureReason === "NO_CANDIDATE_TURNS" || row?.status === "COMPLETED").toBe(true);
  }

  if (row?.conversationId) {
    const cost = await readConversationCost(row.conversationId).catch(() => null);
    console.log(
      `[e2e voice] platform: status=${cost?.status ?? "?"} duration=${cost?.durationSeconds ?? "?"} s cost=${typeof cost?.credits === "number" ? `${cost.credits} credits (~${cost.dollars?.toFixed(4) ?? "?"}), voice surcharge ${cost.voiceSurchargeCredits ?? 0}, spoken ${cost.language ?? "?"}` : "none recorded (a call that never ran is not charged)"}${cost?.failure ? ` error="${cost.failure}"` : ""}`,
    );
  }

  if (row?.status === "COMPLETED") {
    // The typed line was heard as the candidate's: the interview counted, End closed it, and the stored turns hold three fields.
    expect((row.callEnd as { reason?: string } | null)?.reason).toBe("user");
    for (const turn of row.transcript as Record<string, unknown>[]) expect(Object.keys(turn).filter((key) => !["role", "message", "time_in_call_secs"].includes(key))).toEqual([]);
    expect(await accountText(page, t)).not.toContain(TRIAL_AVAILABLE);
    return;
  }
  // No answer was ever heard: the trial was not spent.
  const text = await waitForAccountTrial(page);
  expect(text).toContain(TRIAL_AVAILABLE);
  expect(text).not.toContain("pending return");
});

/** What the platform recorded of the room's tool: the call, the room's answer, and the turn that followed. */
async function printToolTurns(conversationId: string): Promise<void> {
  const record = await readConversationTurns(conversationId).catch(() => null);
  if (!record) return console.log("[e2e voice] the platform's record could not be read");
  console.log(`[e2e voice] record: ${record.turns.length} turn(s), termination "${record.termination ?? ""}"`);
  for (const turn of record.turns) {
    // An invented account and posting: the first words of each line may be printed.
    console.log(`[e2e voice]   ${turn.at ?? "?"}s ${turn.role}${turn.backupModel ? ` [${turn.backupModel}]` : ""} ${[turn.said ? `says "${turn.said}"` : "", ...turn.tools].filter(Boolean).join("; ")}`);
  }
}

/** How the platform's record of the call settles after it ends: what a fast reconnect would find. */
async function printPlatformTimeline(): Promise<void> {
  const row = await db.interview.findFirst({ where: { userId: account.id }, orderBy: { createdAt: "desc" }, select: { conversationId: true } });
  if (!row?.conversationId) return;
  const seen: string[] = [];
  const began = Date.now();
  for (let tick = 0; tick < 20; tick += 1) {
    const cost = await readConversationCost(row.conversationId).catch(() => null);
    const state = cost ? `${cost.status} turns=${cost.turns} duration=${cost.durationSeconds}` : "unreadable";
    if (seen[seen.length - 1]?.split(" @")[0] !== state) seen.push(`${state} @${Math.round((Date.now() - began) / 1000)}s`);
    if (cost?.status === "done" || cost?.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  console.log(`[e2e voice] platform record after End: ${seen.join(" -> ")}`);
}

async function waitForAccountTrial(page: Parameters<typeof signIn>[0]): Promise<string> {
  const until = Date.now() + 150_000;
  let text = await accountText(page, t);
  while (!text.includes(TRIAL_AVAILABLE) && Date.now() < until) {
    await page.waitForTimeout(5_000);
    text = await accountText(page, t);
  }
  return text;
}
