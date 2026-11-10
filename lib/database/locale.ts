import "server-only";

import prisma from "@/lib/prisma";
import { getOptionalUserId, requireUserId } from "@/lib/auth";
import { handleError } from "@/lib/error/handleError";
import { isLocale, type Locale } from "@/lib/i18n/config";

/**
 * The signed-in user's saved language, or null (signed out, never chosen, or no row yet). A failed
 * read is logged and reads as null: a page never fails over its language.
 */
export async function savedLocale(): Promise<Locale | null> {
  const userId = await getOptionalUserId();
  if (!userId) return null;
  try {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
    return isLocale(row?.locale) ? row.locale : null;
  } catch (error) {
    console.error(`[CVision][i18n] saved locale read failed: ${error instanceof Error ? error.name : "unknown"}`);
    return null;
  }
}

/** Saves the caller's language, creating the row if the Clerk webhook has not yet. */
export async function saveLocale(locale: Locale): Promise<void> {
  try {
    const userId = await requireUserId();
    await prisma.user.upsert({ where: { id: userId }, create: { id: userId, locale }, update: { locale } });
  } catch (error) {
    handleError(error, "Failed to save the locale");
  }
}
