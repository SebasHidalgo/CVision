import { requireUserId } from "@/lib/auth";
import { markInterviewEnded } from "@/lib/database/interview";
import { ValidationError } from "@/lib/error/ValidationError";
import { routeOk, toRouteError } from "@/lib/error/toRouteResponse";
import { interviewEndedRequestSchema } from "@/lib/schemas/interviewSessionSchema";

// One guarded write.
export const maxDuration = 10;

const LOG = "[CVision][ended]";

/**
 * The room's report that the call ended, sent from the SDK's disconnect
 * callback without waiting for the answer. It sets `endedAt` once, which
 * shortens the reconcile window from fourteen minutes after the session
 * issue to two minutes after the call. The transcript, when it arrives,
 * overwrites it with the platform's values. Owner-scoped; `recorded` is
 * false when there was nothing to write, including for an id that is not
 * the caller's.
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

    const recorded = await markInterviewEnded({ interviewId: id, endedAt: new Date() });
    console.info(
      `${LOG} interview=${id} reason=${parsed.data.reason ?? "(none)"} recorded=${recorded}`,
    );

    return routeOk({ recorded });
  } catch (error) {
    return toRouteError(error, "Failed to record the end of the interview");
  }
}
