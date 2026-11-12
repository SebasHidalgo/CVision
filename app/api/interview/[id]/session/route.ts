import { buildInterviewerContext } from "@/lib/ai/prompts/interviewer.agent";
import { getUserProfile, requireUserId } from "@/lib/auth";
import { detectPostingLanguage } from "@/lib/ai/postingLanguage";
import {
  fetchInterviewById,
  fetchInterviewCallState,
  reserveInterviewSession,
} from "@/lib/database/interview";
import { finalizeResumableInterview, storedCallCounts } from "@/lib/database/interviewResume";
import { expireAbandonedInterviews } from "@/lib/database/interviewExpiry";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { refundUsage, reserveInterview, resolveInterviewEntitlement, type InterviewReservation } from "@/lib/database/usage";
import { MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { startVoiceSession } from "@/lib/voice";
import { assertVoiceCapacity } from "@/lib/voice/health";
import { STARTABLE_STATUSES, toSegment } from "@/lib/voice/postCall";
import { settlePreviousCall } from "@/lib/voice/reconcile";
import { addSegment, continuityRecord, mergeSegments, MIN_RESUME_SECONDS, readSegments, usedSeconds } from "@/lib/voice/segments";
import { transcriptTurnSchema } from "@/lib/voice/transcript";
import { ValidationError } from "@/lib/error/ValidationError";
import { z } from "zod";
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
import { interviewSessionRequestSchema } from "@/lib/schemas/interviewSessionSchema";
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
 *
 * A start after a dropped call that counted continues the same interview:
 * no new unit, the time left instead of the full length, and a record of
 * what was asked and answered for the interviewer. The call speaks the
 * language the room chose, stored on the interview.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let reservation: InterviewReservation | null = null;
  try {
    const userId = await requireUserId();
    await assertRateLimit(userId, "interviewStart");
    const { id } = await params;

    const requestBody = await request.json().catch(() => ({}));
    const requested = interviewSessionRequestSchema.safeParse(requestBody ?? {});
    if (!requested.success) throw new ValidationError("Invalid session request");

    // A read of an interview is also the sweep for abandoned ones; one
    // expired here answers INTERVIEW_NOT_STARTABLE below.
    await expireAbandonedInterviews(userId);

    // The previous call's record, fetched first when it has not arrived: it decides what this start is.
    const previous = await fetchInterviewCallState(id);
    if (previous) await settlePreviousCall(id, previous, { unthrottled: true, patient: true });

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
    // Sized on the agent this start would use: a reconnect keeps its tier, a first start reads the entitlement.
    const plannedSeconds = interview.tier
      ? INTERVIEW_TIERS[interview.tier].seconds
      : (await resolveInterviewEntitlement(userId)).maxDurationSeconds;
    // Nothing to start: the reservation below refuses it with the quota code.
    if (plannedSeconds > 0) await assertVoiceCapacity(plannedSeconds);

    // The first token takes the unit the entitlement names and fixes the
    // tier and the source; a reconnect reuses what the first token set.
    let tier = interview.tier ?? "FULL";
    let source: Exclude<EntitlementSource, "none"> = sourceOfPaidBy(interview.paidBy) ?? (tier === "TRIAL" ? "trial" : "period");
    if (!interview.usageEventId) {
      reservation = await reserveInterview(userId, interview.id);
      tier = reservation.tier;
      source = reservation.source;
    }
    const { seconds: tierSeconds, gapsToCover } = INTERVIEW_TIERS[tier];

    // The calls so far.
    const state = await fetchInterviewCallState(interview.id);
    if (!state || !STARTABLE_STATUSES.has(state.status)) {
      throw new InterviewNotStartableError("Interview is no longer startable");
    }

    const earlier = readSegments(state.segments);
    const storedTurns = z.array(transcriptTurnSchema).safeParse(state.transcript);
    // The stored call is part of the interview when the candidate spoke in it, or already had in an earlier one.
    const latestCounts =
      state.transcriptSource !== null && state.conversationId !== null && storedTurns.success && storedTurns.data.length > 0 && (earlier.length > 0 || storedCallCounts(state.transcript));
    const calls =
      latestCounts && storedTurns.success && state.conversationId
        ? addSegment(
            earlier,
            toSegment({
              conversationId: state.conversationId,
              turns: storedTurns.data,
              durationSeconds: state.durationSeconds,
              startTimeSeconds: state.endedAt ? Math.round(state.endedAt.getTime() / 1000) - (state.durationSeconds ?? 0) : null,
            }),
          )
        : earlier;
    // A reconnect continues the interview when a call of it counted, or when the room reported a drop whose record is still on its way.
    const resuming = !reservation && (calls.length > 0 || (state.transcriptSource === null && state.resumableUntil !== null));
    const used = resuming
      ? Math.min(
          tierSeconds,
          usedSeconds(
            { segments: earlier, latestRecorded: state.transcriptSource !== null, latestSpoke: Boolean(latestCounts), latestDurationSeconds: state.durationSeconds, lastSessionAt: state.lastSessionAt, endedAt: state.endedAt },
            new Date(),
          ),
        )
      : 0;
    const maxDurationSeconds = tierSeconds - used;
    if (resuming && maxDurationSeconds < MIN_RESUME_SECONDS) {
      // The interview length is used up: it is scored with what exists.
      await finalizeResumableInterview(interview.id);
      throw new InterviewNotStartableError("The interview's time is used up");
    }

    const profile = await getUserProfile();

    const chosen = requested.data.language ?? (state.language === "en" || state.language === "es" ? state.language : detectPostingLanguage(analysis.jobDescription));

    const { dynamicVariables, language } = buildInterviewerContext({
      interviewId: interview.id,
      candidateFirstName: profile.firstName,
      role: interview.role,
      company: analysis.companyName,
      jobDescription: analysis.jobDescription,
      analysisSummary: context.data.overall.summaryText,
      requirements: context.data.jobFit.requirements,
      maxDurationSeconds: tierSeconds,
      gapsToCover,
      language: chosen,
      ...(resuming ? { resume: { remainingSeconds: maxDurationSeconds, record: continuityRecord(mergeSegments(calls)) } } : {}),
    });

    const session = await startVoiceSession({ tier, variables: dynamicVariables });

    const issuedAt = new Date();
    const reserved = await reserveInterviewSession({
      interviewId: interview.id,
      issuedContext: session.variables,
      conversationId: session.conversationId,
      startedAt: interview.startedAt ?? issuedAt,
      issuedAt,
      maxStarts: MAX_INTERVIEW_STARTS,
      language,
      allowedSeconds: maxDurationSeconds,
      ...(latestCounts && state.conversationId ? { carry: { segments: calls, fromConversationId: state.conversationId } } : {}),
      ...(reservation ? { reservation: { usageEventId: reservation.eventId, tier, paidBy: PAID_BY_SOURCE[reservation.source] } } : {}),
    });
    if (!reserved) {
      throw new InterviewNotStartableError("Interview changed while issuing the session");
    }
    if (reservation) {
      console.info(`${LOG} interview=${interview.id} reserved ${reservation.kind} tier=${tier}`);
    }
    if (resuming) {
      console.info(`${LOG} interview=${interview.id} resumed: call ${calls.length + 1}, ${used} s used, ${maxDurationSeconds} s left, language=${language}`);
    }
    reservation = null;

    const body: InterviewSessionResponse = {
      connectionType: "webrtc",
      conversationToken: session.token,
      conversationId: session.conversationId,
      dynamicVariables: session.variables,
      language,
      expiresAt: session.expiresAt.toISOString(),
      maxDurationSeconds,
      source,
      resumed: resuming,
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
