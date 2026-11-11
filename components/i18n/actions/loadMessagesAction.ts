"use server";

import type { Locale } from "@/lib/i18n/config";
import type { LocaleResources } from "@/lib/i18n/instance";
import { pickResources } from "@/lib/i18n/resources";
import { ValidationError } from "@/lib/error/ValidationError";
import { toActionError } from "@/lib/error/toActionResult";
import { loadMessagesInputSchema } from "@/lib/schemas/localeSchema";
import type { ActionResult } from "@/types/action";

/**
 * The switcher's prefetch: another language's strings for the namespaces the page already has, so
 * the client can switch them the moment the user picks it. Public, static data: no session needed.
 */
export async function loadMessagesAction(input: unknown): Promise<ActionResult<{ locale: Locale; resources: LocaleResources }>> {
  try {
    const parsed = loadMessagesInputSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid messages input");
    const { locale, namespaces } = parsed.data;
    return { ok: true, data: { locale, resources: pickResources(locale, [...new Set(namespaces)]) } };
  } catch (error) {
    return toActionError(error, "Failed to load messages");
  }
}
