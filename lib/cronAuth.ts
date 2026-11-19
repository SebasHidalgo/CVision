import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * The cron routes' gate: Vercel sends `CRON_SECRET` as a bearer token on every cron invocation and nobody else
 * holds it. Answers the refusal to send, or null to go on. Without the secret configured every call is refused,
 * loudly: a cron that silently does nothing is worse than one that fails. The comparison runs in constant time
 * over SHA-256 digests (always 32 bytes), so neither the secret's bytes nor its length leak through timing.
 */
export function refuseUnlessCron(request: Request, log: string): Response | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error(`${log} CRON_SECRET is not set; refusing`);
    return Response.json({ ok: false, code: "CRON_MISCONFIGURED" }, { status: 500 });
  }
  const sent = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(sent), digest(`Bearer ${secret}`))) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  return null;
}
