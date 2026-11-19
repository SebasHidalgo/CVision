import { expect, type Page } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, createAccountWithEmail, deleteAccount, signIn, TEST_EMAIL_TAG, type TestAccount } from "./support/accounts";
import { accountOverview, interviewCta, mainText } from "./support/app";
import { copyFor, literal, localeOf, type Copy } from "./support/copy";
import { db } from "./support/db";
import { assertSandbox } from "./support/env";
import { seedAnalysis } from "./support/seed";
import { seedListInterview } from "./support/seedInterviews";
import { normalizeEmail, readTrialPepper, trialClaimHash } from "@/lib/trialClaim";

/**
 * One free trial per email, across a deleted account: an account whose email holds a trial claim (what spending the
 * trial writes) is deleted at Clerk, and a new account on the same address, and one on a subaddress variant of it,
 * get no trial: the room says the email already used it and offers Pro, the analysis page and the account page say
 * so too. No call: the claim is seeded with the server's pepper (both read .env), rooms are seeded rows. Once per
 * interface language.
 */

test.describe.configure({ mode: "serial" });

let first: TestAccount | null = null;
let again: TestAccount | null = null;
let variant: TestAccount | null = null;
let claimHash = "";

/** The claim key the server computes for an address, with the pepper both sides read from .env. */
function claimOf(email: string): string {
  const pepper = readTrialPepper();
  if (!pepper) throw new Error("TRIAL_CLAIM_PEPPER is not set in .env: the server would offer no trial at all");
  const inbox = normalizeEmail(email);
  if (!inbox) throw new Error(`${email} does not normalize`);
  return trialClaimHash(inbox, pepper);
}

/** The same inbox under another subaddress: `e2e-x+algo+clerk_test@example.com` for `e2e-x+clerk_test@example.com`. */
const subaddressOf = (email: string) => email.replace(TEST_EMAIL_TAG, `+algo${TEST_EMAIL_TAG}`);

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  first = await createAccount(`trialclaim-${localeOf(testInfo)}`);
  claimHash = claimOf(first.email);
});

test.afterAll(async () => {
  for (const account of [first, again, variant]) if (account) await deleteAccount(account);
  if (claimHash) await db.trialClaim.deleteMany({ where: { emailHash: claimHash } });
});

const startButton = (page: Page, t: Copy) => page.getByRole("button", { name: literal(t("interview:room.startButton.start"), "i") });

/** A Free account with an analysis and a room that never started, signed in; returns both URLs. */
async function roomFor(page: Page, account: TestAccount): Promise<{ analysis: string; room: string }> {
  const analysisId = await seedAnalysis(account);
  const interviewId = await seedListInterview(account, analysisId, "scheduled");
  await signIn(page, account);
  return { analysis: `/resume/analysis/${analysisId}`, room: `/interview/${interviewId}` };
}

async function openFresh(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function expectClaimedRoom(page: Page, t: Copy, url: string) {
  await openFresh(page, url);
  const text = await mainText(page);
  expect(text).toContain(t("interview:room.offer.pro.titleClaimed"));
  expect(text).toContain(t("interview:room.offer.pro.body", { perMonth: 4, minutes: 12 }));
  await expect(startButton(page, t)).toHaveCount(0);
  const checkout = t("interview:room.offer.pro.checkout", { price: "\u0000" }).split("\u0000")[0].trim();
  await expect(page.getByRole("button", { name: literal(checkout, "i") })).toBeVisible();
}

test("a new email gets its trial in the room", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const { room } = await roomFor(page, first!);
  await openFresh(page, room);
  expect(await mainText(page)).toContain(t("interview:room.source.trial", { minutes: 5 }));
  await expect(startButton(page, t)).toBeVisible();
});

test("the same email on a new account, after the first is deleted: no trial, said so, with the Pro offer", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  // What spending the trial writes; the account's deletion never removes it.
  await db.trialClaim.upsert({ where: { emailHash: claimHash }, create: { emailHash: claimHash }, update: {} });
  const email = first!.email;
  await deleteAccount(first!);
  first = null;
  again = await createAccountWithEmail(email);

  const { analysis, room } = await roomFor(page, again);
  await expectClaimedRoom(page, t, room);

  await openFresh(page, analysis);
  const cta = (await interviewCta(page).innerText()).replace(/\s+/g, " ");
  expect(cta).toContain(t("analysis:cta.heading.trialClaimed"));
  expect(cta).not.toMatch(literal(t("analysis:cta.tryTrial", { minutes: 5 }), "i"));

  const { usage } = await accountOverview(page, t);
  expect(usage).toMatch(new RegExp(`${literal(t("account:trial.label")).source}\\s*${literal(t("account:trial.claimed")).source}`, "i"));
  expect(usage).toContain(t("account:trial.claimedNote"));
});

test("a subaddress variant of the same inbox gets no trial either", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  const email = subaddressOf(again!.email);
  expect(claimOf(email)).toBe(claimHash);
  variant = await createAccountWithEmail(email, "variant");

  const { room } = await roomFor(page, variant);
  await expectClaimedRoom(page, t, room);
});
