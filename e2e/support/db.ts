import { PrismaClient } from "@prisma/client";

/**
 * The suite's own read-only window into the database the dev server
 * writes: the provider id of a subscription (to cancel it at the sandbox)
 * and the conversation id of a call (to read its cost). DATABASE_URL from
 * .env, like the app. One client per worker.
 */
export const db = new PrismaClient();
