import { expect } from "@playwright/test";
import { test } from "./support/fixtures";
import { createAccount, deleteAccount, signIn, type TestAccount } from "./support/accounts";
import { copyFor, literal, localeOf } from "./support/copy";
import { assertSandbox } from "./support/env";

/**
 * The error pages, through the dev-only routes that fail on purpose (/dev/error under the app's shell, /dev/crash
 * outside it, /dev/crash?view=global for the root page's body), and an app page's loading state. What a failure must
 * never show is the error's own words: the forced errors say "must never reach the page". No model, no payment.
 */

test.describe.configure({ mode: "serial" });

const NEVER = /must never reach the page/;
let account: TestAccount;

test.beforeAll(async ({}, testInfo) => {
  assertSandbox();
  account = await createAccount(`errors-${localeOf(testInfo)}`);
});

test.afterAll(async () => {
  if (account) await deleteAccount(account);
});

test("a page that fails on the server keeps the shell, says so, and offers retry and home", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  await page.goto("/dev/error");
  const title = page.getByRole("heading", { level: 1, name: t("errorPage:title") });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  // The shell is still there: the header's navigation and the footer.
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  // The digest of the server's log line, never the message.
  await expect(page.locator("[data-error-reference]")).toHaveText(literal(t("errorPage:reference", { digest: "" }).trim()));
  await expect(page.getByText(NEVER)).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link", { name: t("errorPage:home") })).toHaveAttribute("href", "/");
  // Retrying renders the page again; it fails again, and the page says so again.
  await page.getByRole("button", { name: t("errorPage:retry") }).click();
  await expect(title).toBeVisible();
  await expect(page.getByText(NEVER)).toHaveCount(0);
});

test("a page that fails in the browser shows the same page, with no reference and no message", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  await page.goto("/dev/error?at=client");
  await expect(page.getByRole("heading", { level: 1, name: t("errorPage:title") })).toBeVisible();
  await expect(page.locator("[data-error-reference]")).toHaveCount(0);
  await expect(page.getByText(NEVER)).toHaveCount(0);
});

test("a failure outside the shell draws its own band with the wordmark", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  await page.goto("/dev/crash");
  await expect(page.getByRole("heading", { level: 1, name: t("errorPage:title") })).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
  await expect(page.getByRole("link", { name: t("errorPage:home") })).toHaveCount(2);
  await expect(page.getByText(NEVER)).toHaveCount(0);
});

test("the root error page speaks both languages", async ({ page }) => {
  const [en, es] = [copyFor("en"), copyFor("es")];
  await signIn(page, account);
  await page.goto("/dev/crash?view=global");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText(en("errorPage:title"));
  await expect(heading.locator('[lang="es"]')).toHaveText(es("errorPage:title"));
  await expect(page.locator('p[lang="en"]')).toHaveText(en("errorPage:body"));
  await expect(page.locator('p[lang="es"]')).toHaveText(es("errorPage:body"));
  await expect(page.getByRole("button", { name: `${en("errorPage:retry")} · ${es("errorPage:retry")}` })).toBeVisible();
});

test("an app page shows its frame while it loads", async ({ page }, testInfo) => {
  const t = copyFor(localeOf(testInfo));
  await signIn(page, account);
  // The link is prefetched with its loading state once it is on screen (a production build): wait for that first.
  const prefetched = page
    .waitForResponse((response) => new URL(response.url()).pathname === "/resume/upload" && Boolean(response.request().headers()["next-router-prefetch"]), { timeout: 15_000 })
    .catch(() => null);
  await page.goto("/resume/analyses");
  await expect(page.getByRole("heading", { level: 1, name: t("analyses:page.title") })).toBeVisible();
  await prefetched;
  // The navigation itself is held a few seconds, so what shows meanwhile is the loading state.
  await page.route(
    (url) => url.pathname === "/resume/upload",
    async (route) => {
      const headers = route.request().headers();
      if (headers["rsc"] && !headers["next-router-prefetch"]) await new Promise((resolve) => setTimeout(resolve, 4_000));
      await route.continue();
    },
  );
  await page.getByRole("banner").getByRole("link", { name: t("common:nav.newAnalysis") }).first().click();
  await expect(page.getByRole("status").filter({ hasText: t("upload:intro.loading") })).toBeAttached({ timeout: 3_000 });
  await expect(page.locator("[data-bone]").first()).toBeVisible();
  // The form arrives in the same frame: its heading never moved.
  await expect(page.getByRole("button", { name: t("upload:form.submit") })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status").filter({ hasText: t("upload:intro.loading") })).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
});
