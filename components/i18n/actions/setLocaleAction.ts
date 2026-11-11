"use server";

import { cookies } from "next/headers";
import { getOptionalUserId } from "@/lib/auth";
import { saveLocale } from "@/lib/database/locale";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, type Locale } from "@/lib/i18n/config";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { setLocaleInputSchema } from "@/lib/schemas/localeSchema";
import type { ActionResult } from "@/types/action";

/**
 * The switcher: the cookie for this browser, and `User.locale` when signed in so another browser
 * follows after sign-in. Works signed out (the landing and pricing pages have the switcher too),
 * which is why it starts with the optional session instead of requireUserId.
 */
export async function setLocaleAction(input: unknown): Promise<ActionResult<{ locale: Locale }>> {
  try {
    const userId = await getOptionalUserId();
    const parsed = setLocaleInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid locale input");
    const { locale } = parsed.data;

    (await cookies()).set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
    if (userId) await saveLocale(locale);

    return { ok: true, data: { locale } };
  } catch (error) {
    return toActionError(error, "Failed to set the locale");
  }
}
