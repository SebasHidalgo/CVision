"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, Mic, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import { actionErrorCopy, resetDateCopy } from "@/lib/error/actionErrorCopy";
import { interviewDestination, liveAttempt } from "@/lib/interviewStatus";
import { AGENT_SECONDS } from "@/lib/interviewEntitlement";
import { INTERVIEW_PACK_CREDITS, type InterviewQuotaView } from "@/lib/plans";
import { createInterviewAction } from "@/screens/ResumeAnalysisDetail/actions/createInterviewAction";
import type { ResumeAnalysis } from "@/types/resume";

type InterviewCtaProps = {
  resumeId: string;
  jobTitle: string;
  attempts: ResumeAnalysis["interviews"];
  quota: InterviewQuotaView;
  /** "compact" sits in the header; "full" closes the report. */
  variant: "compact" | "full";
  /** The full variant's list of attempts, rendered by the server. */
  children?: React.ReactNode;
};

const TRIAL_MINUTES = Math.round(AGENT_SECONDS.trial / 60);
const FULL_MINUTES = Math.round(AGENT_SECONDS.main / 60);

/**
 * What the control offers, read off the entitlement (the one decision of
 * which interview the next start gets, lib/interviewEntitlement.ts): the
 * live attempt when there is one; otherwise the free trial, a Pro
 * interview, a Free account's credit, or the reason there is none. Pro's
 * number of interviews is announced; nothing here ever says how many
 * analyses Pro gets.
 */
export type InterviewOffer =
  | { kind: "live" }
  | { kind: "trial" }
  /** The period's interviews, then the pack credits: a button while either is left. */
  | { kind: "pro"; left: number; limit: number; credits: number }
  | { kind: "pro-exhausted"; resetsAt: string }
  /** A Free account holding pack credits: each one is a full interview, before any trial. */
  | { kind: "credits"; credits: number }
  | { kind: "needs-pro" };

export function interviewOffer(quota: InterviewQuotaView, hasLive: boolean): InterviewOffer {
  if (hasLive) return { kind: "live" };
  const { entitlement } = quota;
  const { remaining } = entitlement;
  switch (entitlement.source) {
    case "period":
      return { kind: "pro", left: remaining.period, limit: remaining.periodLimit, credits: remaining.credits };
    case "credit":
      return entitlement.plan === "PRO"
        ? { kind: "pro", left: remaining.period, limit: remaining.periodLimit, credits: remaining.credits }
        : { kind: "credits", credits: remaining.credits };
    case "trial":
      return { kind: "trial" };
    case "none":
      return entitlement.plan === "PRO" && entitlement.resetsAt ? { kind: "pro-exhausted", resetsAt: entitlement.resetsAt } : { kind: "needs-pro" };
  }
}

/** "3 credits left": what a Free account with pack credits sees under the button. */
export function creditsLine(credits: number): string {
  return `${credits} credit${credits === 1 ? "" : "s"} left`;
}

/** "3 of 4 interviews left this period · 5 credits": the period's allowance, then the credits when there are any. */
export function proAllowanceLine(offer: Extract<InterviewOffer, { kind: "pro" }>): string {
  const credits = offer.credits > 0 ? ` · ${offer.credits} credit${offer.credits === 1 ? "" : "s"}` : "";
  return `${offer.left} of ${offer.limit} interviews left this period${credits}`;
}

export default function InterviewCta({
  resumeId,
  jobTitle,
  attempts,
  quota,
  variant,
  children,
}: InterviewCtaProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    setIsCreating(true);

    try {
      const result = await createInterviewAction({ resumeId });

      if (result.ok) {
        // Keep the spinner: resetting now would re-enable the button until the
        // room loads and unmounts this.
        router.push(`/interview/${result.data.interviewId}`);
        return;
      }

      toast.error(actionErrorCopy(result.code, result.meta));
      // A quota refusal means the page's view is stale: re-read it.
      if (result.code === "INTERVIEW_QUOTA_EXCEEDED") router.refresh();
    } catch {
      // Rejected rather than returned: network drop, platform 413/504, or a
      // stale deployment.
      toast.error(actionErrorCopy("REQUEST_FAILED"));
    }

    setIsCreating(false);
  };

  const live = liveAttempt(attempts);
  const rehearsed = attempts.length > 0;
  const offer = interviewOffer(quota, live !== null);

  const compactClasses = "h-11 gap-2 px-5";
  const fullClasses = "group h-12 gap-2 px-7 text-base";
  const buttonClasses = variant === "compact" ? compactClasses : fullClasses;

  const startButton = (label: string, icon: React.ReactNode) => (
    <Button onClick={handleCreate} disabled={isCreating} className={buttonClasses}>
      {isCreating ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Preparing the interview…
        </>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </Button>
  );

  const control = live ? (
    <Button asChild className={buttonClasses}>
      <Link href={interviewDestination(live).href}>
        {interviewDestination(live).label}
        <ArrowRight className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
      </Link>
    </Button>
  ) : offer.kind === "trial" ? (
    startButton(`Try a ${TRIAL_MINUTES}-minute interview, free`, <Mic className="size-4" />)
  ) : offer.kind === "pro" || offer.kind === "credits" ? (
    startButton(
      rehearsed ? "Rehearse again" : "Rehearse the interview",
      rehearsed ? <RotateCcw className="size-4" /> : <Mic className="size-4" />,
    )
  ) : offer.kind === "pro-exhausted" ? (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <p className="text-sm font-medium text-ink">
        {actionErrorCopy("INTERVIEW_QUOTA_EXCEEDED", { plan: "PRO", resetsAt: offer.resetsAt })}
      </p>
      <Link href="/account/billing" className="link-rule text-sm text-ink-2">
        Get {INTERVIEW_PACK_CREDITS} more interviews
      </Link>
    </div>
  ) : (
    <p className="flex h-11 items-center text-sm font-medium text-ink">
      {actionErrorCopy("INTERVIEW_QUOTA_EXCEEDED", { plan: "FREE" })}
    </p>
  );

  // The line under the control: what the plan allows, never Pro's analyses.
  const note =
    offer.kind === "trial"
      ? `${TRIAL_MINUTES} minutes with the interviewer, on us · needs a microphone · works on a phone`
      : offer.kind === "pro"
        ? `${proAllowanceLine(offer)} · up to ${FULL_MINUTES} minutes · needs a microphone`
        : offer.kind === "credits"
          ? `${creditsLine(offer.credits)} · up to ${FULL_MINUTES} minutes · needs a microphone`
          : null;

  if (variant === "compact") return control;

  const heading =
    offer.kind === "live"
      ? "Your interview is ready."
      : offer.kind === "trial"
        ? `Try the ${jobTitle} interview out loud.`
        : offer.kind === "needs-pro"
          ? "Rehearse this interview out loud, with Pro."
          : offer.kind === "pro-exhausted"
            ? "This period's interviews are used."
            : rehearsed
              ? "Rehearse it again."
              : `Rehearse the ${jobTitle} interview out loud.`;

  const lede =
    offer.kind === "live"
      ? "An attempt is waiting in the room. Finish it, and the feedback lands here."
      : offer.kind === "trial"
        ? `A voice interviewer built from this exact posting asks about the gaps your analysis found, you answer out loud, and you get scored on what you said. Your free trial runs ${TRIAL_MINUTES} minutes.`
        : offer.kind === "needs-pro"
          ? "You used the free trial. Pro interviews run twelve minutes, four a month, each scored against this posting and the gaps your analysis found."
          : offer.kind === "pro-exhausted"
            ? `Every rehearsal is scored against the same posting and the same gaps. The next ones come back ${resetDateCopy(offer.resetsAt)}.`
            : rehearsed
              ? "Every attempt is scored on its own against the same posting and the same gaps, so you can see what changed."
              : "A voice interviewer built from this exact posting asks the questions, you answer out loud, and when you end the call you get scored on five things, with the transcript.";

  return (
    <section
      aria-labelledby="interview-cta-title"
      className="mt-6 border-t border-line pt-12 lg:pt-16"
    >
      <Eyebrow tick>Next</Eyebrow>
      <div className="mt-5 grid gap-8 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <h2 id="interview-cta-title" className="display-md text-ink">
            {heading}
          </h2>
          <p className="lede mt-4 max-w-xl">{lede}</p>
        </div>
        <div className="flex flex-col items-start gap-3 md:col-span-4 md:items-end">
          {control}
          {note && <p className="eyebrow">{note}</p>}
        </div>
      </div>
      {children && <div className="mt-10">{children}</div>}
    </section>
  );
}
