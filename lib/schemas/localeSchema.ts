import { z } from "zod";
import { LOCALES } from "@/lib/i18n/config";

/** The switcher's input: one of the interface languages. */
export const setLocaleInputSchema = z.object({ locale: z.enum(LOCALES) });

export type SetLocaleInput = z.infer<typeof setLocaleInputSchema>;
