import { after } from "next/server";
import { generateInterviewFeedback } from "@/lib/ai/interviewFeedback";
import { requireUserId } from "@/lib/auth";
import { fetchInterviewStatus } from "@/lib/database/interview";
import { expireAbandonedInterviews } from "@/lib/database/interviewExpiry";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/elevenlabs/agentConfig";
import { isStranded } from "@/lib/elevenlabs/postCall";
import {
  reconcileChangedRow,
  reconcileNeedsFeedback,
  reconcileStrandedInterview,
} from "@/lib/elevenlabs/reconcile";
import { NotFoundError } from "@/lib/error/errors";
import { routeOk, toRouteError } from "@/lib/error/toRouteResponse";
import type { InterviewStatusSnapshot } from "@/lib/schemas/interviewSessionSchema";

// One small read; the reconcile fallback adds one platform call and a write.
export const maxDuration = 30;

const LOG = "[CVision][status]";

/**
 * What the feedback page polls while an interview is being saved or scored:
 * the status, whether feedback exists, how many starts were used and why the
 * latest step produced nothing. Owner-scoped, JSON only, no rendering. When
 * the interview is stranded (the call must be over and no transcript came),
 * the poll is also what fetches the transcript from the platform.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireUserId();
    // Polled every 3 to 10 s by design: this ceiling only stops a runaway loop.
    await assertRateLimit(userId, "status");
    const { id } = await params;

    // A read of an interview is also the sweep for abandoned ones.
    await expireAbandonedInterviews(userId);

    let row = await fetchInterviewStatus(id);
    if (!row) throw new NotFoundError("Interview not found");

    if (isStranded(row, new Date(), MAX_INTERVIEW_DURATION_SECONDS)) {
      try {
        const outcome = await reconcileStrandedInterview(id);
        if (reconcileNeedsFeedback(outcome)) {
          after(async () => {
            try {
              const result = await generateInterviewFeedback(id);
              console.info(`${LOG} feedback after reconcile interview=${id}: ${result.kind}`);
            } catch (error) {
              console.error(`${LOG} feedback after reconcile interview=${id} threw:`, error);
            }
          });
        }
        if (reconcileChangedRow(outcome)) {
          row = (await fetchInterviewStatus(id)) ?? row;
        }
      } catch (error) {
        // The platform failed to answer: the status is still true as read,
        // and the next poll tries again.
        console.error(`${LOG} reconcile interview=${id} failed:`, error);
      }
    }

    const body: InterviewStatusSnapshot = {
      status: row.status,
      hasFeedback: row.hasFeedback,
      startCount: row.startCount,
      failureReason: row.failureReason,
    };
    return routeOk(body);
  } catch (error) {
    return toRouteError(error, "Failed to read interview status");
  }
}
