import { z } from "zod";
import { LOCALES, NAMESPACES } from "@/lib/i18n/config";

/** The switcher's input: one of the interface languages. */
export const setLocaleInputSchema = z.object({ locale: z.enum(LOCALES) });

export type SetLocaleInput = z.infer<typeof setLocaleInputSchema>;

/** Another language's strings for the namespaces a page already shows. */
export const loadMessagesInputSchema = z.object({
  locale: z.enum(LOCALES),
  namespaces: z.array(z.enum(NAMESPACES)).min(1).max(NAMESPACES.length),
});
