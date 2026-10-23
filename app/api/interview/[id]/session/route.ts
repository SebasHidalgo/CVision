import { buildInterviewerContext } from "@/lib/ai/prompts/interviewer.agent";
import { getUserProfile, requireUserId } from "@/lib/auth";
import {
  fetchInterviewById,
  reserveInterviewSession,
} from "@/lib/database/interview";
import { expireAbandonedInterviews } from "@/lib/database/interviewExpiry";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { refundUsage, reserveInterview, type InterviewReservation } from "@/lib/database/usage";
import { MAX_INTERVIEW_STARTS } from "@/lib/elevenlabs/agentConfig";
import { issueConversationToken } from "@/lib/elevenlabs/client";
import { assertVoiceCapacity } from "@/lib/elevenlabs/health";
import { STARTABLE_STATUSES } from "@/lib/elevenlabs/postCall";
import {
  InterviewContextMissingError,
  InterviewExpiredError,
  InterviewNotStartableError,
  InterviewStartLimitError,
  NotFoundError,
} from "@/lib/error/errors";
import { routeOk, toRouteError } from "@/lib/error/toRouteResponse";
import { PAID_BY_SOURCE, sourceOfPaidBy, type EntitlementSource } from "@/lib/interviewEntitlement";
import { INTERVIEW_TIERS } from "@/lib/plans";
import { interviewContextSchema } from "@/lib/schemas/interviewSchema";
import type { InterviewSessionResponse } from "@/types/interview";

// Two database round trips, one Clerk profile read and a 10 s token call.
export const maxDuration = 30;

const LOG = "[CVision][session]";

/**
 * Issues a voice session for one of the caller's interviews: a WebRTC
 * conversation token plus the context the browser hands to the agent. The
 * server keeps its own copy of that context, so what the browser passes is a
 * convenience, not an input to anything that is scored.
 *
 * Every check runs before the token call, which is the first thing here that
 * touches a paid platform, and so does the quota: the interview's usage unit
 * is reserved on its first token, in this request, never on creation and
 * never again on a reconnect. Before the reservation, the platform's own
 * balance is checked (cached for a minute): below the floor, the start is
 * refused with nothing reserved. The write comes after the token, in one
 * guarded update: if that update finds the interview no longer startable (a
 * second tab won the race), the token is dropped unused, the unit goes back
 * and the caller gets a 409.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let reservation: InterviewReservation | null = null;
  try {
    const userId = await requireUserId();
    await assertRateLimit(userId, "interviewStart");
    const { id } = await params;

    // A read of an interview is also the sweep for abandoned ones; one
    // expired here answers INTERVIEW_NOT_STARTABLE below.
    await expireAbandonedInterviews(userId);

    // Owner-scoped: a foreign id is indistinguishable from a missing one.
    const interview = await fetchInterviewById(id);
    if (!interview) throw new NotFoundError("Interview not found");

    // Expired (two hours without a session, possibly by the sweep just
    // above): closed and not charged, which is what the room should say,
    // not that feedback is on its way.
    if (interview.status === "EXPIRED") throw new InterviewExpiredError();
    if (!STARTABLE_STATUSES.has(interview.status)) {
      throw new InterviewNotStartableError(`Interview is ${interview.status}`);
    }
    if (interview.startCount >= MAX_INTERVIEW_STARTS) {
      throw new InterviewStartLimitError();
    }

    const analysis = interview.resumeAnalysis;
    const context = analysis?.feedback
      ? interviewContextSchema.safeParse(analysis.feedback)
      : null;
    if (!analysis || !context?.success) {
      throw new InterviewContextMissingError();
    }

    // The platform's balance, before anything is reserved or counted: a
    // workspace out of credits issues the token and drops the call a second
    // later, which would spend a start and the candidate's patience for
    // nothing. Refused as VOICE_UNAVAILABLE, honestly, with nothing charged.
    await assertVoiceCapacity();

    // The first token takes the unit the entitlement names and fixes the
    // tier and the source; a reconnect reuses what the first token set.
    let tier = interview.tier ?? "FULL";
    let source: Exclude<EntitlementSource, "none"> = sourceOfPaidBy(interview.paidBy) ?? (tier === "TRIAL" ? "trial" : "period");
    if (!interview.usageEventId) {
      reservation = await reserveInterview(userId, interview.id);
      tier = reservation.tier;
      source = reservation.source;
    }
    const { seconds: maxDurationSeconds, gapsToCover } = INTERVIEW_TIERS[tier];

    const profile = await getUserProfile();

    const { dynamicVariables, language } = buildInterviewerContext({
      interviewId: interview.id,
      candidateFirstName: profile.firstName,
      role: interview.role,
      company: analysis.companyName,
      jobDescription: analysis.jobDescription,
      analysisSummary: context.data.overall.summaryText,
      requirements: context.data.jobFit.requirements,
      maxDurationSeconds,
      gapsToCover,
    });

    const session = await issueConversationToken(tier);

    const issuedAt = new Date();
    const reserved = await reserveInterviewSession({
      interviewId: interview.id,
      issuedContext: dynamicVariables,
      conversationId: session.conversationId,
      startedAt: interview.startedAt ?? issuedAt,
      issuedAt,
      maxStarts: MAX_INTERVIEW_STARTS,
      ...(reservation ? { reservation: { usageEventId: reservation.eventId, tier, paidBy: PAID_BY_SOURCE[reservation.source] } } : {}),
    });
    if (!reserved) {
      throw new InterviewNotStartableError("Interview changed while issuing the session");
    }
    if (reservation) {
      console.info(`${LOG} interview=${interview.id} reserved ${reservation.kind} tier=${tier}`);
    }
    reservation = null;

    const body: InterviewSessionResponse = {
      connectionType: "webrtc",
      conversationToken: session.token,
      conversationId: session.conversationId,
      dynamicVariables,
      language,
      expiresAt: session.expiresAt.toISOString(),
      maxDurationSeconds,
      source,
    };
    return routeOk(body);
  } catch (error) {
    // No token reached the browser: the unit reserved above goes back.
    if (reservation) {
      const code = (error as { code?: string })?.code ?? "SESSION_NOT_ISSUED";
      await refundUsage(reservation.eventId, code).catch((refundError) => {
        console.error(`${LOG} refund of ${reservation?.eventId} failed:`, refundError);
      });
    }
    return toRouteError(error, "Failed to issue an interview session");
  }
}
