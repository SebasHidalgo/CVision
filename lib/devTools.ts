/**
 * Dev-only tools (the room preview route, `npm run dev:usage`) run only when
 * asked for explicitly and only against the sandbox: ALLOW_DEV_TOOLS=1 and
 * PADDLE_ENV=sandbox, and never on a production deployment.
 */
export function devToolsAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.ALLOW_DEV_TOOLS === "1" && env.PADDLE_ENV === "sandbox" && env.VERCEL_ENV !== "production";
}
