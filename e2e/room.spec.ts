import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { copyFor, literal, localeOf, type Copy } from "./support/copy";
import { assertSandbox } from "./support/env";
import { settle } from "./support/layout";

// The interview room in every state, on the dev preview (/dev/room-preview?state=…): no call, no model, no payment.
// Also: the landing's replica is the same component tree, and the turn follows who holds it, not the SDK's mode.

test.describe.configure({ mode: "serial" });
let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`room-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

const room = (page: Page) => page.locator('[data-room-part="frame"]');
const part = (page: Page, name: string) => room(page).locator(`[data-room-part="${name}"]`).first();
const statusWords = (page: Page) => part(page, "status");
const meter = (page: Page, who: "interviewer" | "candidate") => room(page).locator(`[data-meter="${who}"]`);
const button = (page: Page, t: Copy, key: string, options?: Record<string, unknown>) => room(page).getByRole("button", { name: literal(t(key, options), "i") });
/** The text before an interpolated value: "Your 4 interviews renew on {{date}}." → "Your 4 interviews renew on". */
const before = (t: Copy, key: string, options: Record<string, unknown>) => t(key, { ...options, date: "\u0000" }).split("\u0000")[0].trim();

async function open(page: Page, state: string) {
  await page.goto(`/dev/room-preview?state=${state}`);
  await room(page).waitFor({ timeout: 60_000 });
}

/** One check per state: what a reader must see there, in the project's language. */
const STATES: Record<string, (page: Page, t: Copy) => Promise<void>> = {
  ready: async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.ready"));
    await expect(room(page)).toContainText(t("interview:room.source.period", { count: 3, limit: 4 }));
    await expect(room(page).getByLabel(t("interview:room.language.label"))).toBeVisible();
    await expect(button(page, t, "interview:room.startButton.start")).toBeEnabled();
    await expect(meter(page, "interviewer")).toHaveAttribute("data-floor", "none");
  },
  trial: async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.source.trial", { minutes: 5 }));
    await expect(room(page).getByRole("timer")).toHaveText("5:00");
  },
  credit: async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.source.credit", { count: 2 }));
  },
  held: async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.source.held"));
  },
  "mic-denied": async (page, t) => {
    await expect(part(page, "notice")).toHaveText(t("interview:room.microphone.denied"));
    await expect(button(page, t, "interview:room.startButton.start")).toBeEnabled();
  },
  microphone: async (page, t) => {
    await expect(button(page, t, "interview:room.startButton.microphone")).toBeDisabled();
  },
  connecting: async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.connecting"));
    await expect(button(page, t, "interview:room.startButton.connecting")).toBeDisabled();
  },
  queued: async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.queued"));
    await expect(room(page).getByRole("note")).toHaveText(t("interview:room.queue.waiting"));
    await expect(part(page, "notice")).toHaveText(t("interview:room.queue.short"));
  },
  waiting: async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.waiting"));
    await expect(statusWords(page)).toHaveAttribute("data-turn", "waiting");
    await expect(meter(page, "interviewer")).toHaveAttribute("data-floor", "held");
    await expect(meter(page, "candidate")).toHaveAttribute("data-floor", "none");
  },
  speaking: async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.speaking"));
    await expect(meter(page, "interviewer")).toHaveAttribute("data-floor", "has");
    await expect(button(page, t, "interview:room.end")).toBeEnabled();
  },
  "your-turn": async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.yourTurn"));
    await expect(meter(page, "candidate")).toHaveAttribute("data-floor", "has");
    await expect(meter(page, "interviewer")).toHaveAttribute("data-floor", "none");
  },
  "last-minute": async (page, t) => {
    await expect(part(page, "notice")).toHaveText(t("interview:room.countdown.warning"));
  },
  closing: async (page, t) => {
    await expect(room(page).getByRole("timer")).toHaveText(t("interview:room.clock.closing"));
    await expect(part(page, "notice")).toHaveText(t("interview:room.countdown.closing"));
    await expect(button(page, t, "interview:room.end")).toBeEnabled();
  },
  goodbye: async (page, t) => {
    await expect(part(page, "notice")).toHaveText(t("interview:room.countdown.goodbye"));
    await expect(statusWords(page)).toHaveText(t("interview:room.status.speaking"));
  },
  ending: async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.ending"));
    await expect(button(page, t, "interview:room.ending")).toBeDisabled();
  },
  "early-end": async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.endedEarly"));
    await expect(room(page)).toContainText(t("interview:room.dropped.early", { left: "2:03" }));
    await expect(button(page, t, "interview:room.startButton.continue")).toBeEnabled();
    await expect(button(page, t, "interview:room.dropped.finish")).toBeEnabled();
    await expect(part(page, "notice")).toHaveText(t("interview:room.continueStarts", { count: 2 }));
  },
  dropped: async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.dropped"));
    await expect(room(page)).toContainText(t("interview:room.dropped.at", { at: "3:12", left: "8:48" }));
    await expect(button(page, t, "interview:room.startButton.reconnect")).toBeEnabled();
    await expect(part(page, "notice")).toHaveText(t("interview:room.reconnect", { count: 1 }));
  },
  "dropped-no-time": async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.dropped.noTime"));
    await expect(button(page, t, "interview:room.startButton.reconnect")).toHaveCount(0);
    await expect(part(page, "meter")).toHaveCount(0);
  },
  "silent-drop": async (page, t) => {
    await expect(room(page).getByRole("note")).toHaveText(t("interview:room.dropped.silent", { count: 12 }));
    await expect(button(page, t, "interview:room.startButton.startAgain")).toBeEnabled();
    await expect(button(page, t, "interview:room.dropped.finish")).toHaveCount(0);
  },
  cap: async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.noStarts"));
    await expect(room(page).getByRole("link", { name: literal(t("interview:room.backToAnalysis"), "i") })).toBeVisible();
    await expect(room(page).getByRole("button")).toHaveCount(0);
    await expect(part(page, "meter")).toHaveCount(0);
  },
  "voice-down": async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.voiceDown"));
    await expect(button(page, t, "interview:room.offer.checkAgain")).toBeVisible();
    await expect(button(page, t, "interview:room.startButton.start")).toHaveCount(0);
  },
  "needs-pro": async (page, t) => {
    await expect(statusWords(page)).toHaveText(t("interview:room.status.noInterviews"));
    await expect(room(page)).toContainText(t("interview:room.offer.pro.title"));
    await expect(room(page).getByRole("button", { name: literal(before(t, "interview:room.offer.pro.checkout", { price: "\u0000" }), "i") })).toBeVisible();
    await expect(room(page).getByRole("timer")).toHaveCount(0);
  },
  "needs-pro-had-voice": async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.offer.pro.titleHadVoice"));
  },
  "needs-pro-claimed": async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.offer.pro.titleClaimed"));
    await expect(room(page).getByRole("button", { name: literal(before(t, "interview:room.offer.pro.checkout", { price: "\u0000" }), "i") })).toBeVisible();
  },
  paused: async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.offer.subscription.paused"));
    await expect(room(page).getByRole("button", { name: literal(t("billing:portal.manage"), "i") })).toBeVisible();
  },
  "needs-pack": async (page, t) => {
    await expect(room(page)).toContainText(before(t, "interview:room.offer.pack.title", { limit: 4 }));
    await expect(room(page).getByRole("button", { name: literal(before(t, "interview:room.offer.pack.checkout", { credits: 4, price: "\u0000" }), "i") })).toBeVisible();
  },
  "past-due": async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.offer.subscription.pastDue"));
  },
  "purchase-waiting": async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.offer.waiting"));
  },
  confirming: async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.offer.confirming"));
    await expect(button(page, t, "interview:room.offer.checkAgain")).toBeVisible();
  },
  stalled: async (page, t) => {
    await expect(room(page)).toContainText(t("interview:room.offer.stalled"));
    await expect(room(page).getByRole("link", { name: literal(t("interview:room.offer.openAccount"), "i") })).toBeVisible();
  },
};

test("every state of the room, in its words, with its control", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  for (const [state, check] of Object.entries(STATES)) {
    await test.step(state, async () => {
      await open(page, state);
      await check(page, t);
    });
  }
});

/** The bars' transforms of one channel, as drawn now. */
const bars = (channel: Locator) => channel.locator("span[style]").evaluateAll((els) => els.map((el) => (el as HTMLElement).style.transform).join("|"));

test("the speaking indicator moves with the voice, and holds still under reduced motion", async ({ page }) => {
  await signIn(page, account);
  await open(page, "speaking");
  const first = await bars(meter(page, "interviewer"));
  await expect.poll(() => bars(meter(page, "interviewer")), { timeout: 5_000 }).not.toBe(first);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "speaking");
  const still = await bars(meter(page, "interviewer"));
  await page.waitForTimeout(600);
  expect(await bars(meter(page, "interviewer"))).toBe(still);
  // Still, but not at rest: the channel that holds the turn keeps its shape.
  expect(new Set(still.split("|")).size).toBeGreaterThan(3);
});

test("the turn: the interviewer's through a pause between sentences, then the candidate's; the interviewer's while it composes; the candidate's at once on an interruption", async ({ page }) => {
  await signIn(page, account);
  // Every change of the status's turn, sampled faster than the script moves.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __turns: string[] }).__turns = seen;
    window.setInterval(() => {
      const turn = document.querySelector('[data-room-part="status"]')?.getAttribute("data-turn");
      if (turn && turn !== seen.at(-1)) seen.push(turn);
    }, 40);
  });
  await open(page, "turns");
  // The script runs 12 s (screens/Interview/utils/previewStates.ts, turnScript).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __turns: string[] }).__turns.join(" ")), { timeout: 20_000 })
    .toBe("waiting interviewer candidate waiting interviewer candidate");
});

/** The parts of the room in document order. */
const partsOf = (page: Page, variant: "page" | "replica") =>
  page.locator(`[data-room-part="frame"][data-variant="${variant}"]`).evaluate((frame) => [frame, ...frame.querySelectorAll("[data-room-part]")].map((el) => el.getAttribute("data-room-part")));
/** The classes of the parts that must look the same in both. */
const KEY_PARTS = ["attempt", "role", "company", "presence", "status", "meter", "log", "notice"];
const classesOf = (page: Page, variant: "page" | "replica") =>
  page
    .locator(`[data-room-part="frame"][data-variant="${variant}"]`)
    .evaluate((frame, keys) => Object.fromEntries(keys.map((key) => [key, frame.querySelector(`[data-room-part="${key}"]`)?.className ?? null])), KEY_PARTS);

test("the landing's room is the app's room: the same parts in the same order, the same classes, before and during the call", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);

  await page.goto("/");
  await settle(page);
  await page.locator("#interview").scrollIntoViewIfNeeded();
  const landingIdle = await partsOf(page, "replica");
  const landingIdleClasses = await classesOf(page, "replica");
  await page.locator('[data-variant="replica"]').getByRole("button", { name: literal(t("interview:room.startButton.start"), "i") }).click();
  await expect(page.locator('[data-variant="replica"] [data-room-part="status"]')).toHaveAttribute("data-turn", /interviewer|waiting/, { timeout: 5_000 });
  const landingLive = await partsOf(page, "replica");
  const landingLiveClasses = await classesOf(page, "replica");

  await open(page, "ready");
  expect(await partsOf(page, "page")).toEqual(landingIdle);
  expect(await classesOf(page, "page")).toEqual(landingIdleClasses);
  await open(page, "speaking");
  expect(await partsOf(page, "page")).toEqual(landingLive);
  expect(await classesOf(page, "page")).toEqual(landingLiveClasses);
});
