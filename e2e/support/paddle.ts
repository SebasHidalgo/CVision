import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { db } from "./db";
import { required } from "./env";

/**
 * Paddle's sandbox overlay, driven the way the owner's browser proof of
 * M6-C found it: the customer step asks for email and country, then
 * Continue; the card fields live in the main `paddle_frame`; a PayPal
 * button precedes the card form, so the pay button is found by its text
 * ("Subscribe now" for Pro, "Pay $9.00" for the pack), never by type.
 * Sandbox test card 4242 4242 4242 4242.
 */

export const PADDLE_FRAME = 'iframe[name="paddle_frame"]';

/** Clicks the checkout button and waits for the overlay; returns both for the spec to assert on. */
export async function openCheckout(page: Page, label: RegExp): Promise<{ button: Locator; frame: FrameLocator }> {
  const button = page.getByRole("button", { name: label }).first();
  await button.waitFor({ timeout: 30_000 });
  await button.click();
  const frame = page.frameLocator(PADDLE_FRAME);
  await frame.locator("body").waitFor({ timeout: 60_000 });
  return { button, frame };
}

/** The first visible match of `selector` in any frame of the page, within `timeoutMs`. */
async function findInFrames(page: Page, selector: string, timeoutMs: number): Promise<Locator | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const frame of page.frames()) {
      const locator = frame.locator(selector).first();
      if (await locator.isVisible({ timeout: 200 }).catch(() => false)) return locator;
    }
    await page.waitForTimeout(300);
  }
  return null;
}

/** Fills the overlay's customer and card steps and pays. Returns when the pay button was clicked. */
export async function payInOverlay(page: Page, { email }: { email: string }): Promise<void> {
  // The overlay needs a moment after its body exists before its form is live.
  await page.waitForTimeout(3_000);

  const emailField = await findInFrames(page, 'input[name="email"], input[type="email"]', 15_000);
  if (!emailField) throw new Error("Paddle overlay: no email field");
  await emailField.fill(email);

  const country = await findInFrames(page, 'select[name="countryCode"], select[name="country"]', 3_000);
  if (country) await country.selectOption({ value: "AR" }).catch(() => country.selectOption({ label: "Argentina" }).catch(() => {}));
  const postcode = await findInFrames(page, 'input[name="postcode"], input[name="postalCode"], input[autocomplete="postal-code"]', 1_500);
  if (postcode) await postcode.fill("1000");

  const cont = await findInFrames(page, 'button[type="submit"], button:has-text("Continue")', 5_000);
  if (!cont) throw new Error("Paddle overlay: no Continue button on the customer step");
  await cont.click();

  const number = await findInFrames(page, 'input[name="cardNumber"], input[autocomplete="cc-number"], input[placeholder*="1234"], input[id*="cardNumber" i], input[name*="cardnumber" i]', 30_000);
  if (!number) throw new Error("Paddle overlay: no card number field");
  await number.click();
  await number.pressSequentially("4242424242424242", { delay: 20 });
  const name = await findInFrames(page, 'input[name="cardholderName"], input[autocomplete="cc-name"], input[id*="cardholder" i], input[name*="holder" i]', 2_000);
  if (name) await name.fill("Test Buyer");
  const expiry = await findInFrames(page, 'input[name="expiryDate"], input[autocomplete="cc-exp"], input[id*="expir" i], input[name*="expir" i], input[placeholder*="MM"]', 2_000);
  if (expiry) {
    await expiry.click();
    await expiry.pressSequentially("1230", { delay: 20 });
  }
  const cvv = await findInFrames(page, 'input[name="cvv"], input[autocomplete="cc-csc"], input[id*="cvv" i], input[name*="cvv" i], input[name*="cvc" i], input[placeholder*="CVC" i], input[placeholder*="CVV" i]', 2_000);
  if (cvv) {
    await cvv.click();
    await cvv.pressSequentially("123", { delay: 20 });
  }

  let pay: Locator | null = null;
  const until = Date.now() + 15_000;
  while (!pay && Date.now() < until) {
    for (const frame of page.frames()) {
      const candidate = frame.getByRole("button", { name: /subscribe now|pay now|buy now|^pay\b|complete purchase/i }).first();
      if (await candidate.isVisible({ timeout: 300 }).catch(() => false)) {
        pay = candidate;
        break;
      }
    }
    if (!pay) await page.waitForTimeout(500);
  }
  if (!pay) throw new Error("Paddle overlay: no pay button");
  await pay.click();
}

/** Closes the overlay without paying: its close button, or Escape. */
export async function closeOverlay(page: Page): Promise<void> {
  const frame = page.frameLocator(PADDLE_FRAME);
  const close = frame.getByRole("button", { name: /close/i }).first();
  if (await close.isVisible({ timeout: 5_000 }).catch(() => false)) await close.click();
  else await page.keyboard.press("Escape");
  await expect(page.locator(PADDLE_FRAME)).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Cancels the account's subscription at the sandbox, effective now, the
 * way the customer portal would: by the subscription id the app mirrored.
 * One REST call with the server key; the webhook does the rest.
 */
export async function cancelSubscriptionNow(userId: string): Promise<string> {
  const row = await db.subscription.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" }, select: { providerSubscriptionId: true } });
  if (!row) throw new Error(`no subscription row for user ${userId}: did the webhook land?`);
  const response = await fetch(`https://sandbox-api.paddle.com/subscriptions/${row.providerSubscriptionId}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${required("PADDLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ effective_from: "immediately" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`cancelling ${row.providerSubscriptionId} answered HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return row.providerSubscriptionId;
}
