import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { interviewCta, mainText, openRoom, warmRoutes } from "./support/app";
import { copyFor, literal, localeOf, type Copy } from "./support/copy";
import { db } from "./support/db";
import { assertSandbox, webhooksReachable } from "./support/env";
import { openCheckout, payInOverlay } from "./support/paddle";
import { seedAnalysis, setUsage } from "./support/seed";
import { formatMoney } from "@/lib/format";
import { resetDateCopy } from "@/lib/error/actionErrorCopy";
import { DEV_VOICE_DOWN_COOKIE } from "@/lib/devTools";
import { BASE_URL } from "./support/env";

/**
 * What the interview room shows on entry, before any button: the start's source when one can start, the Pro offer
 * to a Free account with nothing left, the renewal date and the pack to a Pro one, the start cap. The ledger is put
 * in each state with dev:usage's core (no call); the two offers are bought in the sandbox from the room, and Start
 * must appear with no reload. Seeded analyses: no model call. Once per interface language; the tunnel must be up.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

let free: TestAccount;
let pro: TestAccount;
let freeRoom = "";
let freeAnalysis = "";
let proRoom = "";

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  const reach = await webhooksReachable();
  if (!reach.ok) throw new Error(`the entry specs buy in the sandbox and need the webhooks: ${reach.why}`);
  await warmRoutes();
  free = await createAccount(`entry-free-${localeOf(testInfo)}`);
  pro = await createAccount(`entry-pro-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  for (const account of [free, pro]) if (account) await deleteAccount(account);
});

const startButton = (page: Page, t: Copy) => page.getByRole("button", { name: literal(t("interview:room.startButton.start"), "i") });
/** A label with a {{price}} blank, matched up to the blank. */
const upToPrice = (t: Copy, key: string, options: Record<string, unknown> = {}) => literal(t(key, { ...options, price: "\u0000" }).split("\u0000")[0].trim(), "i");

async function openFresh(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Buys from the room and waits for Start, proving no reload happened: a value set on the window before survives. */
async function buyInRoom(page: Page, t: Copy, label: RegExp, email: string) {
  await page.evaluate(() => ((window as unknown as { __roomMark: number }).__roomMark = 7));
  const url = page.url();
  await openCheckout(page, label);
  await payInOverlay(page, { email });
  await expect(page.getByRole("status").filter({ hasText: literal(t("interview:room.offer.waiting")) }).or(startButton(page, t))).toBeVisible({ timeout: 120_000 });
  await expect(startButton(page, t)).toBeVisible({ timeout: 180_000 });
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => (window as unknown as { __roomMark?: number }).__roomMark)).toBe(7);
}

test("Free with the trial: the room says the trial pays, with Start", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, free);
  freeAnalysis = `/resume/analysis/${await seedAnalysis(free)}`;
  await page.goto(freeAnalysis);
  freeRoom = await openRoom(page, t);
  expect(await mainText(page)).toContain(t("interview:room.source.trial", { minutes: 5 }));
  await expect(startButton(page, t)).toBeVisible();
});

test("Free with the trial used and no credits: the Pro offer, no Start; the analysis page and the list agree", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  await setUsage(free, { trialUsed: true });
  await signIn(page, free);
  await openFresh(page, freeRoom);
  const text = await mainText(page);
  expect(text).toContain(t("interview:room.offer.pro.title"));
  expect(text).toContain(t("interview:room.offer.pro.body", { perMonth: 4, minutes: 12 }));
  expect(text).toMatch(literal(t("interview:room.status.noInterviews"), "i"));
  await expect(startButton(page, t)).toHaveCount(0);
  await expect(page.getByRole("button", { name: literal(t("interview:room.offer.pro.checkout", { price: formatMoney(15, "USD", locale) }), "i") })).toBeVisible();

  await page.goto(freeAnalysis);
  const cta = (await interviewCta(page).innerText()).replace(/\s+/g, " ");
  expect(cta).toContain(t("errors:codes.INTERVIEW_QUOTA_EXCEEDED"));
  expect(cta).not.toMatch(literal(t("analysis:cta.openRoom"), "i"));
  expect(cta).not.toMatch(literal(t("analysis:cta.tryTrial", { minutes: 5 }), "i"));
  expect(cta).toMatch(literal(t("analysis:attempts.reading.needsPro"), "i"));

  await page.goto("/interviews");
  expect(await mainText(page)).toMatch(literal(t("interview:list.reading.needsPro"), "i"));
});

test("Free with a pack credit: the room says one credit pays", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await setUsage(free, { trialUsed: true, credits: 1 });
  await signIn(page, free);
  await openFresh(page, freeRoom);
  expect(await mainText(page)).toContain(t("interview:room.source.credit", { count: 1 }));
  await expect(startButton(page, t)).toBeVisible();
  await setUsage(free, { trialUsed: true, credits: 0 });
});

test("the start cap is shown on entry, with its own copy and no Start", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const id = freeRoom.split("/").pop()!;
  await db.interview.update({ where: { id }, data: { startCount: 3 } });
  await signIn(page, free);
  await openFresh(page, freeRoom);
  const text = await mainText(page);
  expect(text).toMatch(literal(t("interview:room.status.noStarts"), "i"));
  expect(text).toContain(t("errors:codes.INTERVIEW_START_LIMIT"));
  await expect(startButton(page, t)).toHaveCount(0);
  await db.interview.update({ where: { id }, data: { startCount: 0 } });
});

test("with voice down, the room says so and sells nothing (the server's dev-only outage switch)", async ({ page, context }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, free);
  await context.addCookies([{ name: DEV_VOICE_DOWN_COOKIE, value: "1", url: BASE_URL }]);
  await openFresh(page, freeRoom);
  const text = await mainText(page);
  expect(text).toContain(t("errors:codes.VOICE_UNAVAILABLE"));
  expect(text).not.toContain(t("interview:room.offer.pro.title"));
  await expect(startButton(page, t)).toHaveCount(0);
  await expect(page.getByRole("button", { name: upToPrice(t, "interview:room.offer.pro.checkout") })).toHaveCount(0);
  await expect(page.getByRole("button", { name: literal(t("interview:room.offer.checkAgain"), "i") })).toBeVisible();
  await context.clearCookies({ name: DEV_VOICE_DOWN_COOKIE });
});

test("an interview that already holds its unit continues, whatever the counts", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const id = freeRoom.split("/").pop()!;
  // The trial is used and nothing is left, but this interview reserved its unit at its first start.
  const event = await db.usageEvent.create({ data: { userId: free.id, kind: "INTERVIEW_TRIAL", refId: `e2e-held:${id}` } });
  await db.interview.update({ where: { id }, data: { usageEventId: event.id, tier: "TRIAL", paidBy: "TRIAL", startCount: 1, status: "IN_PROGRESS", lastSessionAt: new Date() } });
  try {
    await signIn(page, free);
    await openFresh(page, freeRoom);
    expect(await mainText(page)).toContain(t("interview:room.source.held"));
    await expect(startButton(page, t)).toBeVisible();
  } finally {
    await db.interview.update({ where: { id }, data: { usageEventId: null, tier: null, paidBy: null, startCount: 0, status: "SCHEDULED", lastSessionAt: null } });
    await db.usageEvent.delete({ where: { id: event.id } });
  }
});

test("a paused subscription shows its state and the billing portal, not a Pro checkout that would refuse", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const row = await db.subscription.create({
    data: { userId: free.id, providerSubscriptionId: `sub_e2e_paused_${localeOf(testInfo)}_${Date.now()}`, status: "PAUSED", priceKey: "pro_monthly", providerUpdatedAt: new Date() },
  });
  try {
    await signIn(page, free);
    await openFresh(page, freeRoom);
    const text = await mainText(page);
    expect(text).toContain(t("interview:room.offer.subscription.paused"));
    await expect(page.getByRole("button", { name: literal(t("billing:portal.manage"), "i") })).toBeVisible();
    await expect(page.getByRole("button", { name: upToPrice(t, "interview:room.offer.pro.checkout") })).toHaveCount(0);
    await expect(startButton(page, t)).toHaveCount(0);
  } finally {
    await db.subscription.delete({ where: { id: row.id } });
  }
});

test("buying Pro from the room turns the offer into Start without a reload", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, free);
  await openFresh(page, freeRoom);
  await buyInRoom(page, t, upToPrice(t, "interview:room.offer.pro.checkout"), free.email);
  expect(await mainText(page)).toContain(t("interview:room.source.period", { count: 4, limit: 4 }));
});

test("Pro with interviews left: the room counts them", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await setUsage(pro, { plan: "PRO", interviewsUsed: 1 });
  await signIn(page, pro);
  await page.goto(`/resume/analysis/${await seedAnalysis(pro)}`);
  proRoom = await openRoom(page, t);
  expect(await mainText(page)).toContain(t("interview:room.source.period", { count: 3, limit: 4 }));
});

test("Pro with the period used: the renewal date and the pack, no Start; buying the pack brings Start without a reload", async ({ page }, testInfo) => {
  const locale = localeOf(testInfo);
  const t = copyFor(locale);
  const report = await setUsage(pro, { plan: "PRO", interviewsUsed: 4 });
  await signIn(page, pro);
  await openFresh(page, proRoom);
  const text = await mainText(page);
  expect(text).toContain(t("interview:room.offer.pack.title", { limit: 4, date: resetDateCopy(report.periodEnd.toISOString(), locale) }));
  // A formatted price can carry a non-breaking space: literal() matches any whitespace.
  expect(text).toMatch(literal(t("interview:room.offer.pack.body", { credits: 4, price: formatMoney(9, "USD", locale) })));
  await expect(startButton(page, t)).toHaveCount(0);

  await buyInRoom(page, t, upToPrice(t, "interview:room.offer.pack.checkout", { credits: 4 }), pro.email);
  expect(await mainText(page)).toContain(t("interview:room.source.credit", { count: 4 }));
});
