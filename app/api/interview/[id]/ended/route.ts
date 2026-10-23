import { after } from "next/server";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import { requireUserId } from "@/lib/auth";
import { markInterviewEnded } from "@/lib/database/interview";
import { EARLY_END_WINDOW_MS } from "@/lib/elevenlabs/postCall";
import { reconcileNeedsFeedback, reconcileStrandedInterview } from "@/lib/elevenlabs/reconcile";
import { ValidationError } from "@/lib/error/ValidationError";
import { routeOk, toRouteError } from "@/lib/error/toRouteResponse";
import { interviewEndedRequestSchema } from "@/lib/schemas/interviewSessionSchema";

// One guarded write, then, for a call that ended at once, the platform
// fetch (10 s) and the feedback it may need (45 s) in after().
export const maxDuration = 60;

const LOG = "[CVision][ended]";

/**
 * The room's report that the call ended, sent from the SDK's disconnect
 * callback without waiting for the answer. It sets `endedAt` once, which
 * shortens the reconcile window from fourteen minutes after the session
 * issue to two minutes after the call. The transcript, when it arrives,
 * overwrites it with the platform's values. Owner-scoped; `recorded` is
 * false when there was nothing to write, including for an id that is not
 * the caller's.
 *
 * A call that ended within seconds of its session being issued never ran:
 * the platform refused it (no credits, a broken agent) and sends no
 * webhook for it. For those the conversation is fetched right away, after
 * the response, through the same throttled reconcile the status poll uses,
 * so the feedback page learns in seconds, not after the grace, that the
 * start was given back.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUserId();
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const parsed = interviewEndedRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError("Invalid end-of-call report");

    const mark = await markInterviewEnded({ interviewId: id, endedAt: new Date() });
    const early = mark.recorded && mark.sessionAgeMs !== null && mark.sessionAgeMs <= EARLY_END_WINDOW_MS;
    console.info(
      `${LOG} interview=${id} reason=${parsed.data.reason ?? "(none)"} recorded=${mark.recorded}${early ? ` early (${Math.round(mark.sessionAgeMs! / 1000)} s after the session): fetching the conversation now` : ""}`,
    );

    if (early) {
      after(async () => {
        try {
          const outcome = await reconcileStrandedInterview(id, new Date(), { graceSeconds: 0 });
          console.info(`${LOG} early reconcile interview=${id}: ${outcome.kind}`);
          if (reconcileNeedsFeedback(outcome)) {
            const result = await generateInterviewFeedback(id);
            console.info(`${LOG} feedback after early reconcile interview=${id}: ${result.kind}`);
          }
        } catch (error) {
          // The status poll retries in a minute; nothing is lost.
          console.error(`${LOG} early reconcile interview=${id} failed:`, error);
        }
      });
    }

    return routeOk({ recorded: mark.recorded });
  } catch (error) {
    return toRouteError(error, "Failed to record the end of the interview");
  }
}
