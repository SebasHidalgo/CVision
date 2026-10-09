import { buildInterviewerContext } from "@/lib/ai/prompts/interviewer.agent";
import { getUserProfile, requireUserId } from "@/lib/auth";
import {
  fetchInterviewById,
  reserveInterviewSession,
} from "@/lib/database/interview";
import {
  MAX_INTERVIEW_DURATION_SECONDS,
  MAX_INTERVIEW_STARTS,
} from "@/lib/elevenlabs/agentConfig";
import { issueConversationToken } from "@/lib/elevenlabs/client";
import { STARTABLE_STATUSES } from "@/lib/elevenlabs/postCall";
import {
  InterviewContextMissingError,
  InterviewNotStartableError,
  InterviewStartLimitError,
  NotFoundError,
} from "@/lib/error/errors";
import { routeOk, toRouteError } from "@/lib/error/toRouteResponse";
import { interviewContextSchema } from "@/lib/schemas/interviewSchema";
import type { InterviewSessionResponse } from "@/types/interview";

// Two database round trips, one Clerk profile read and a 10 s token call.
export const maxDuration = 30;

/**
 * Issues a voice session for one of the caller's interviews: a WebRTC
 * conversation token plus the context the browser hands to the agent. The
 * server keeps its own copy of that context, so what the browser passes is a
 * convenience, not an input to anything that is scored.
 *
 * Every check runs before the token call, which is the first thing here that
 * touches a paid platform. The write comes after it, in one guarded update:
 * if that update finds the interview no longer startable (a second tab won
 * the race), the token is dropped unused and the caller gets a 409.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireUserId();
    const { id } = await params;

    // Owner-scoped: a foreign id is indistinguishable from a missing one.
    const interview = await fetchInterviewById(id);
    if (!interview) throw new NotFoundError("Interview not found");

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

    const profile = await getUserProfile();

    const { dynamicVariables, language } = buildInterviewerContext({
      interviewId: interview.id,
      candidateFirstName: profile.firstName,
      role: interview.role,
      company: analysis.companyName,
      jobDescription: analysis.jobDescription,
      analysisSummary: context.data.overall.summaryText,
      requirements: context.data.jobFit.requirements,
      maxDurationSeconds: MAX_INTERVIEW_DURATION_SECONDS,
    });

    const session = await issueConversationToken();

    const reserved = await reserveInterviewSession({
      interviewId: interview.id,
      issuedContext: dynamicVariables,
      conversationId: session.conversationId,
      startedAt: interview.startedAt ?? new Date(),
      maxStarts: MAX_INTERVIEW_STARTS,
    });
    if (!reserved) {
      throw new InterviewNotStartableError("Interview changed while issuing the session");
    }

    const body: InterviewSessionResponse = {
      connectionType: "webrtc",
      conversationToken: session.token,
      conversationId: session.conversationId,
      dynamicVariables,
      language,
      expiresAt: session.expiresAt.toISOString(),
      maxDurationSeconds: MAX_INTERVIEW_DURATION_SECONDS,
    };
    return routeOk(body);
  } catch (error) {
    return toRouteError(error, "Failed to issue an interview session");
  }
}
