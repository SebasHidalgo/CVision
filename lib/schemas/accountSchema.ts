import { z } from "zod";

/** What the account page's delete sends: an explicit yes, never an id (the session says whose account). */
export const deleteAccountInputSchema = z.object({
  confirm: z.literal(true),
});
