import { redirect } from "next/navigation";
import ClientMessages from "@/components/i18n/ClientMessages";
import { getAuthUser } from "@/lib/auth";
import { detectPostingLanguage, type InterviewLanguage } from "@/lib/ai/postingLanguage";
import { fetchInterviewById, fetchInterviewCallState } from "@/lib/database/interview";
import { finalizeLapsedInterviews, storedCallCounts } from "@/lib/database/interviewResume";
import { currentInterviewEntitlement } from "@/lib/database/usage";
import { MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { AGENT_SECONDS, sourceOfPaidBy } from "@/lib/interviewEntitlement";
import { decideRoomEntry } from "@/lib/interviewEntry";
import { CATALOG, CATALOG_CURRENCY } from "@/lib/billing/catalog";
import { formatMoney } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { interviewPhase } from "@/lib/interviewStatus";
import { INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS } from "@/lib/plans";
import { voiceEntryStatus } from "@/lib/voice/health";
import { settlePreviousCall } from "@/lib/voice/reconcile";
import { readSegments, resumeState } from "@/lib/voice/segments";
import InterviewRoomLoader from "./components/InterviewRoomLoader";

type InterviewScreenProps = {
  interviewId: string;
};

export default async function InterviewScreen({
  interviewId,
}: InterviewScreenProps) {
  // Already scoped to the owner: another user's interview comes back null.
  let interview = await fetchInterviewById(interviewId);
  if (!interview) redirect("/interviews");

  // A dropped interview whose resume window is over is scored, not reopened.
  if (interview.status === "IN_PROGRESS" && interview.resumableUntil && interview.resumableUntil.getTime() <= Date.now()) {
    await finalizeLapsedInterviews(interview.userId);
    interview = await fetchInterviewById(interviewId);
    if (!interview) redirect("/interviews");
  }

  // A call whose record has not arrived: ask the platform first, so the room shows what the next start gets.
  const changed = await settlePreviousCall(interview.id, interview);
  if (changed) {
    interview = await fetchInterviewById(interviewId);
    if (!interview) redirect("/interviews");
  }

  // Only an interview with nothing scoreable yet opens the room. Everything
  // else (pending, done, failed, expired) is the feedback page's to explain.
  if (interviewPhase(interview.status) !== "ready") {
    redirect(`/interview/${interview.id}/feedback`);
  }

  // Without a linked analysis there is no job context for the interviewer.
  if (!interview.resumeAnalysis || !interview.resumeAnalysisId) redirect("/interviews");

  const user = await getAuthUser();

  // Before the first token, what the next start would get is decided by
  // the one entitlement function the session endpoint will run too, so
  // the length the room shows is the length the call will have. After it,
  // the interview's own tier and source are the truth (a reconnect keeps
  // them).
  const paid = interview.tier && interview.usageEventId ? { tier: interview.tier, source: sourceOfPaidBy(interview.paidBy) } : null;
  const entitlement = paid ? null : await currentInterviewEntitlement();
  const maxDurationSeconds = paid ? INTERVIEW_TIERS[paid.tier].seconds : (entitlement?.maxDurationSeconds ?? 0);

  // An earlier call of this interview dropped: the room opens on what is left of it.
  const calls = paid && interview.startCount > 0 ? await fetchInterviewCallState(interview.id) : null;
  const resumed = calls
    ? resumeState(
        {
          segments: readSegments(calls.segments),
          latestRecorded: calls.transcriptSource !== null,
          latestSpoke: storedCallCounts(calls.transcript) || readSegments(calls.segments).length > 0,
          latestDurationSeconds: calls.durationSeconds,
          lastSessionAt: calls.lastSessionAt,
          endedAt: calls.endedAt,
          status: calls.status,
          resumableUntil: calls.resumableUntil,
          startCount: calls.startCount,
        },
        maxDurationSeconds,
        MAX_INTERVIEW_STARTS,
        new Date(),
      )
    : null;
  const resume = resumed && calls?.resumableUntil ? { usedSeconds: resumed.usedSeconds, resumable: resumed.resumable } : null;

  // What the room offers on entry, from the same entitlement the session endpoint runs; Start stays its authority.
  // Voice health is asked for the agent a start (or a purchase) would use, from the minute-long cache.
  const atCap = interview.startCount >= MAX_INTERVIEW_STARTS;
  const voiceSeconds = paid ? maxDurationSeconds : entitlement && entitlement.source !== "none" ? entitlement.maxDurationSeconds : AGENT_SECONDS.main;
  const voiceUp = atCap ? true : (await voiceEntryStatus(voiceSeconds)) === "up";
  const entry = decideRoomEntry({
    startCount: interview.startCount,
    maxStarts: MAX_INTERVIEW_STARTS,
    held: paid !== null,
    resumable: resume?.resumable === true,
    entitlement,
    voiceUp,
  });
  const locale = await getLocale();
  const price = (key: keyof typeof CATALOG) => formatMoney(Number(CATALOG[key].amountMinor) / 100, CATALOG_CURRENCY, locale);
  const offer = {
    prices: { pro: price("pro_monthly"), pack: price("interview_pack") },
    proInterviewsPerMonth: PLANS.PRO.interviewsPerMonth,
    fullMinutes: Math.round(AGENT_SECONDS.main / 60),
    packCredits: INTERVIEW_PACK_CREDITS,
    periodLimit: entitlement?.remaining.periodLimit ?? PLANS.PRO.interviewsPerMonth,
  };
  const counts = entitlement ? { period: entitlement.remaining.period, periodLimit: entitlement.remaining.periodLimit, credits: entitlement.remaining.credits } : null;

  // The room proposes the language already chosen for this interview, or the posting's.
  const language: InterviewLanguage =
    interview.language === "en" || interview.language === "es" ? interview.language : detectPostingLanguage(interview.resumeAnalysis.jobDescription);

  // The room and its on-demand chunk read the interview namespace (and billing, for its checkout) from the provider.
  return (
    <ClientMessages ns={["interview", "billing"]}>
      <InterviewRoomLoader
        interviewId={interview.id}
        role={interview.role}
        company={interview.resumeAnalysis.companyName}
        candidateName={user.firstName ?? user.fullName}
        analysisId={interview.resumeAnalysisId}
        attemptNumber={interview.attemptNumber}
        startCount={interview.startCount}
        maxStarts={MAX_INTERVIEW_STARTS}
        maxDurationSeconds={maxDurationSeconds}
        language={language}
        resume={resume}
        entry={entry}
        counts={counts}
        offer={offer}
      />
    </ClientMessages>
  );
}
