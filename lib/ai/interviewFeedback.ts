import "server-only";

import { z } from "zod";
import { generateJson } from "@/lib/ai/client";
import {
  candidateText,
  describeInterviewCounts,
  guardInterviewFeedback,
  type InterviewGuardReport,
} from "@/lib/ai/interviewGuardrails";
import { computeInterviewStats, describeInterviewStats, isCandidateTurn } from "@/lib/ai/interviewStats";
import { detectPostingLanguage, type InterviewLanguage } from "@/lib/ai/postingLanguage";
import {
  formatTranscript,
  interviewFeedbackPrompt,
  interviewFeedbackSystemPrompt,
} from "@/lib/ai/prompts/interview-feedback.prompt";
import { requirementGaps } from "@/lib/ai/prompts/interviewer.agent";
import {
  computeTotalScore,
  feedbackSchema,
  type AiFeedback,
  type InterviewFeedbackReport,
  type InterviewStats,
} from "@/lib/ai/schemas";
import {
  claimInterviewForFeedback,
  completeInterviewFeedback,
  failInterviewFeedback,
  releaseInterviewFeedback,
  type ClaimedInterview,
} from "@/lib/database/interviewFeedbackJob";
import { transcriptTurnSchema, type TranscriptTurn } from "@/lib/elevenlabs/postCall";
import { AppError, type ErrorCode } from "@/lib/error/errors";
import { interviewContextSchema } from "@/lib/schemas/interviewSchema";
import type { Requirement } from "@/lib/schemas/resumeSchema";

/**
 * Turns a stored transcript into stored feedback. One entry point for the
 * webhook (after the response), the feedback page (lazy, when it finds a
 * pending interview) and the owner's retry. Idempotent and race-safe by
 * construction: the first thing it does is a conditional claim, and a
 * caller that fails to claim does nothing and pays nothing.
 */

// Not yet measured on this prompt: the input is a transcript plus the
// posting and the breakdown, the output is smaller than an analysis, so the
// analysis budget times 1.5. The webhook route's maxDuration is sized on top.
export const FEEDBACK_TIMEOUT_MS = 45_000;

/** Claims, not calls: the second claim that fails the provider ends the interview. */
export const FEEDBACK_MAX_ATTEMPTS = 2;

/** Stored in `Interview.failureReason`; the UI translates them. */
export const FEEDBACK_FAILURE_REASONS = {
  noCandidateTurns: "NO_CANDIDATE_TURNS",
  transcriptInvalid: "TRANSCRIPT_INVALID",
  contextMissing: "CONTEXT_MISSING",
  feedbackFailed: "FEEDBACK_FAILED",
} as const;

export type FeedbackFailureReason =
  (typeof FEEDBACK_FAILURE_REASONS)[keyof typeof FEEDBACK_FAILURE_REASONS];

export type GenerateFeedbackOutcome =
  | { kind: "completed"; feedbackId: string }
  /** Not claimable: not pending, already done, or a live generator has it. */
  | { kind: "skipped" }
  /** The provider failed and an attempt remains; the row is pending again. */
  | { kind: "retry-later"; code: ErrorCode }
  | { kind: "failed"; reason: FeedbackFailureReason; code?: ErrorCode };

const transcriptSchema = z.array(transcriptTurnSchema);

/** The dynamic variables the session issued, when the row has them. */
const issuedContextSchema = z
  .object({ candidate_name: z.string().optional(), language_name: z.string().optional() })
  .loose();

export type FeedbackContext = {
  candidateName: string;
  language: InterviewLanguage;
  role: string;
  company: string;
  jobDescription: string;
  analysisSummary: string;
  requirements: Requirement[];
  gaps: Requirement[];
};

/**
 * Everything the prompt needs, from the stored rows only. Null when the
 * analysis is missing or does not parse: there is nothing to judge against.
 */
export function buildFeedbackContext(row: ClaimedInterview): FeedbackContext | null {
  const analysis = row.resumeAnalysis;
  if (!analysis?.feedback) return null;
  const parsed = interviewContextSchema.safeParse(analysis.feedback);
  if (!parsed.success) return null;

  const issued = issuedContextSchema.safeParse(row.issuedContext ?? {});
  const candidateName = issued.success && issued.data.candidate_name?.trim()
    ? issued.data.candidate_name.trim()
    : "the candidate";
  const language: InterviewLanguage =
    issued.success && issued.data.language_name === "Spanish"
      ? "es"
      : issued.success && issued.data.language_name === "English"
        ? "en"
        : detectPostingLanguage(analysis.jobDescription);

  const requirements = parsed.data.jobFit.requirements;
  return {
    candidateName,
    language,
    role: analysis.jobTitle || row.role,
    company: analysis.companyName,
    jobDescription: analysis.jobDescription,
    analysisSummary: parsed.data.overall.summaryText,
    requirements,
    gaps: requirementGaps(requirements),
  };
}

/**
 * Everything the model was shown, so a number or a term in the prose that is
 * in none of it counts as invented. Quotes are held to a stricter source:
 * the candidate turns alone.
 */
export function feedbackAllowedText({
  context,
  turns,
  stats,
}: {
  context: FeedbackContext;
  turns: TranscriptTurn[];
  stats: InterviewStats;
}): string {
  return [
    formatTranscript(turns),
    context.jobDescription,
    context.analysisSummary,
    context.requirements.map((r) => `${r.requirement} ${r.evidence} ${r.note}`).join("\n"),
    describeInterviewStats(stats),
  ].join("\n");
}

export type ScoredTranscript = {
  feedback: AiFeedback;
  report: InterviewFeedbackReport;
  guard: InterviewGuardReport;
};

/**
 * The model step, start to finish, with no database in it: the generator
 * below and the evaluation harness both go through here, so the harness
 * measures the request production sends.
 */
export async function scoreTranscript({
  context,
  turns,
  durationSeconds,
  timeoutMs = FEEDBACK_TIMEOUT_MS,
}: {
  context: FeedbackContext;
  turns: TranscriptTurn[];
  durationSeconds: number | null;
  timeoutMs?: number;
}): Promise<ScoredTranscript> {
  const stats: InterviewStats = computeInterviewStats(turns, durationSeconds);
  const prompt = interviewFeedbackPrompt({ ...context, turns, stats });

  const answer = await generateJson({
    system: interviewFeedbackSystemPrompt,
    prompt,
    schema: feedbackSchema,
    timeoutMs,
  });

  // Quotes against the candidate's words only; numbers and terms against
  // everything the model was shown.
  const { feedback, guard } = guardInterviewFeedback({
    candidateText: candidateText(turns),
    allowedText: feedbackAllowedText({ context, turns, stats }),
    gaps: context.gaps,
    feedback: answer,
  });

  return {
    feedback,
    guard,
    report: {
      ...feedback,
      // Derived here, not asked of the model: it answered with totals that
      // did not match its own category scores.
      totalScore: computeTotalScore(feedback.categoryScores),
      interviewStats: stats,
    },
  };
}

/**
 * The state machine:
 *
 *   FEEDBACK_PENDING --claim--> GENERATING --ok--> COMPLETED
 *                                   |--provider failed, attempts left--> FEEDBACK_PENDING
 *                                   |--provider failed, none left-----> FAILED
 *                                   |--no transcript / no context-----> FAILED
 *
 * A GENERATING row older than FEEDBACK_CLAIM_STALE_MS can be claimed again,
 * which is how a worker that died mid-call is recovered.
 */
export async function generateInterviewFeedback(
  interviewId: string,
): Promise<GenerateFeedbackOutcome> {
  const row = await claimInterviewForFeedback(interviewId);
  if (!row) return { kind: "skipped" };

  const fail = async (reason: FeedbackFailureReason, code?: ErrorCode) => {
    await failInterviewFeedback({ interviewId, reason });
    console.warn(`[CVision][feedback] interview=${interviewId} failed: ${reason}${code ? ` (${code})` : ""}`);
    return { kind: "failed" as const, reason, ...(code ? { code } : {}) };
  };

  const turns = transcriptSchema.safeParse(row.transcript);
  if (!turns.success) return fail(FEEDBACK_FAILURE_REASONS.transcriptInvalid);
  // Belt to the webhook's suspender: it never hands over a transcript
  // without candidate turns, but the row is Json and could be edited by hand.
  if (!turns.data.some(isCandidateTurn)) return fail(FEEDBACK_FAILURE_REASONS.noCandidateTurns);

  const context = buildFeedbackContext(row);
  if (!context) return fail(FEEDBACK_FAILURE_REASONS.contextMissing);

  let scored: ScoredTranscript;
  try {
    scored = await scoreTranscript({ context, turns: turns.data, durationSeconds: row.durationSeconds });
  } catch (error) {
    const code: ErrorCode = error instanceof AppError ? error.code : "UNKNOWN";
    console.error(`[CVision][feedback] interview=${interviewId} attempt ${row.feedbackAttempts} failed:`, error);
    if (row.feedbackAttempts >= FEEDBACK_MAX_ATTEMPTS) {
      return fail(FEEDBACK_FAILURE_REASONS.feedbackFailed, code);
    }
    await releaseInterviewFeedback({ interviewId, reason: FEEDBACK_FAILURE_REASONS.feedbackFailed });
    return { kind: "retry-later", code };
  }

  const note = describeInterviewCounts(scored.guard.counts);
  if (note) {
    // Counts only: the intervention values are the candidate's words.
    console.warn(`[CVision][feedback] interview=${interviewId} guardrail fired: ${note}`);
  }

  const feedbackId = await completeInterviewFeedback({
    interviewId,
    totalScore: scored.report.totalScore,
    report: scored.report,
  });
  if (!feedbackId) return { kind: "skipped" };

  console.info(`[CVision][feedback] interview=${interviewId} completed, total=${scored.report.totalScore}`);
  return { kind: "completed", feedbackId };
}
