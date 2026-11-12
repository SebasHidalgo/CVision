import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { accountText, interviewCta, mainText, openRoom, roomLength, runAnalysis, warmRoutes } from "./support/app";
import { copyFor, literal, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";

/**
 * A fresh Free account: what it is told it has, and what its one trial
 * interview looks like before Start. One analysis (one model call, plus its
 * translation in Spanish); no call is placed. Runs once per interface language.
 */

test.describe.configure({ mode: "serial" });

let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  await warmRoutes();
  account = await createAccount(`free-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

test("a new account is on Free, with the trial available and no credits", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  const text = await accountText(page, t);
  expect(text).toMatch(literal(t("account:intro.titleFree")));
  // innerText carries the page's uppercase styling and glues the figure to its unit.
  expect(text).toMatch(new RegExp(`${literal(t("account:trial.label")).source}\\s*${literal(t("account:trial.available")).source}`, "i"));
  expect(text).toContain(t("account:trial.availableNote", { minutes: 5 }));
  // Free has no period of interviews and, with no pack ever bought, no credits line.
  expect(text).not.toMatch(literal(t("account:interviews.label"), "i"));
  expect(text).not.toMatch(literal(t("account:credits.label"), "i"));
  expect(text).toMatch(new RegExp(`${literal(t("account:analyses.label")).source}\\s*3\\s*${literal(t("account:analyses.ofMonth", { limit: 3 })).source}`, "i"));
});

test("an analysis offers the 5-minute trial, and the room promises five minutes on the trial", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  await runAnalysis(page);
  // The analysis page in the interface language: translated when it was created, so no "Translating…" state.
  expect(await page.locator("html").getAttribute("lang")).toBe(localeOf(testInfo));
  const analysis = await mainText(page);
  expect(analysis).toContain(t("analysis:dimensions.fit.label"));
  expect(analysis).not.toContain(t("common:translation.pending"));
  expect(analysis).not.toContain(t("common:translation.unavailable"));
  expect((await interviewCta(page).innerText()).replace(/\s+/g, " ")).toMatch(literal(t("analysis:cta.tryTrial", { minutes: 5 }), "i"));

  await openRoom(page, t);
  expect(await roomLength(page, t)).toBe("5:00");
  const text = await mainText(page);
  expect(text).toContain(t("interview:room.upTo", { count: 5 }));
  expect(text).toContain(t("interview:room.source.trial", { minutes: 5 }));
  expect(text).toMatch(literal(t("analysis:attempts.attempt", { number: 1 }), "i"));

  // The room proposes the posting language (English here), whatever the interface language, and lets it be changed.
  const language = page.getByLabel(t("interview:room.language.label"));
  expect(await language.inputValue()).toBe("en");
  expect(await language.locator("option").allInnerTexts()).toEqual([t("interview:room.language.en"), t("interview:room.language.es")]);
  await language.selectOption("es");
  expect(await language.inputValue()).toBe("es");
});
