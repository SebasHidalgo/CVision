"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, Mic, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { buttonClass, textLinkClass } from "@/components/design-system/Button";
import { Surface } from "@/components/design-system/Surface";
import { useErrorCopy, useResetDate } from "@/hooks/useErrorCopy";
import { attemptRan, interviewDestination, liveAttempt } from "@/lib/interviewStatus";
import { AGENT_SECONDS } from "@/lib/interviewEntitlement";
import { entryCanStart, waitingInterviewEntry, type WaitingInterview } from "@/lib/interviewEntry";
import { MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { INTERVIEW_PACK_CREDITS, PLANS, type InterviewQuotaView } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { createInterviewAction } from "@/screens/ResumeAnalysisDetail/actions/createInterviewAction";
import type { ResumeAnalysis } from "@/types/resume";

type InterviewCtaProps = {
  resumeId: string;
  jobTitle: string;
  attempts: ResumeAnalysis["interviews"];
  /** A room opened and never started: the one to continue to, ahead of the attempts. */
  room: ResumeAnalysis["unstartedRoom"];
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

/** A waiting attempt is offered only when it can start (or its room has something to say): one the plan cannot start falls through to what to buy, as in the room. */
export function interviewOffer(quota: InterviewQuotaView, live: WaitingInterview | null, now = new Date()): InterviewOffer {
  if (live) {
    const entry = waitingInterviewEntry(live, quota.entitlement, MAX_INTERVIEW_STARTS, now);
    if (entryCanStart(entry) || entry.kind === "start-cap") return { kind: "live" };
  }
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

export default function InterviewCta({
  resumeId,
  jobTitle,
  attempts,
  room,
  quota,
  variant,
  children,
}: InterviewCtaProps) {
  const router = useRouter();
  const { t } = useTranslation("analysis");
  const errorCopy = useErrorCopy();
  const resetDate = useResetDate();
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

      toast.error(errorCopy(result.code, result.meta));
      // A quota refusal means the page's view is stale: re-read it.
      if (result.code === "INTERVIEW_QUOTA_EXCEEDED") router.refresh();
    } catch {
      // Rejected rather than returned: network drop, platform 413/504, or a
      // stale deployment.
      toast.error(errorCopy("REQUEST_FAILED"));
    }

    setIsCreating(false);
  };

  // One live room per analysis: an unstarted one, or a started one that can still go on.
  const live = room ?? liveAttempt(attempts);
  // "Again" only after a rehearsal that ran: an expired or never-answered attempt was not one.
  const rehearsed = attempts.some(attemptRan);
  const offer = interviewOffer(quota, live);

  // Labels wrap inside the button instead of overflowing it: a nowrap label is a min-content width
  // that pushes the button over the text beside it (the Spanish trial label did).
  const buttonClasses = buttonClass({
    size: "md",
    className: cn(
      "group h-auto max-w-full whitespace-normal py-2.5 text-center disabled:cursor-progress disabled:opacity-70",
      variant === "full" && "min-h-[52px] px-7 text-[16px]",
    ),
  });

  const startButton = (label: string, icon: React.ReactNode) => (
    <button type="button" onClick={handleCreate} disabled={isCreating} className={buttonClasses}>
      {isCreating ? (
        <>
          <Loader2 aria-hidden className="size-4 flex-none animate-spin" />
          {t("cta.preparing")}
        </>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </button>
  );

  const icon = "size-4 flex-none";

  // A live attempt that can start is in the "ready" phase: its link goes to the room.
  const control = offer.kind === "live" && live ? (
    <Link href={interviewDestination(live).href} className={buttonClasses}>
      {t("cta.openRoom")}
      <ArrowRight
        aria-hidden
        className={cn(icon, "transition-transform duration-300 ease-out group-hover:translate-x-1 motion-reduce:transition-none")}
      />
    </Link>
  ) : offer.kind === "trial" ? (
    startButton(t("cta.tryTrial", { minutes: TRIAL_MINUTES }), <Mic aria-hidden className={icon} />)
  ) : offer.kind === "pro" || offer.kind === "credits" ? (
    startButton(
      rehearsed ? t("cta.rehearseAgain") : t("cta.rehearse"),
      rehearsed ? <RotateCcw aria-hidden className={icon} /> : <Mic aria-hidden className={icon} />,
    )
  ) : offer.kind === "pro-exhausted" ? (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p className="text-body font-medium text-ink">
        {errorCopy("INTERVIEW_QUOTA_EXCEEDED", { plan: "PRO", resetsAt: offer.resetsAt })}
      </p>
      <Link href="/account/billing" className={cn(textLinkClass, "text-ink underline underline-offset-4 decoration-ink-3")}>
        {t("cta.getMore", { count: INTERVIEW_PACK_CREDITS })}
      </Link>
    </div>
  ) : (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p className="text-body font-medium text-ink">{errorCopy("INTERVIEW_QUOTA_EXCEEDED", { plan: "FREE" })}</p>
      <Link href="/pricing" className={cn(textLinkClass, "text-ink underline underline-offset-4 decoration-ink-3")}>
        {t("cta.seePro")}
      </Link>
    </div>
  );

  // The line under the control: what the plan allows, never Pro's analyses. Facts joined by " · ".
  const length = t("cta.note.length", { minutes: FULL_MINUTES });
  const microphone = t("cta.note.microphone");
  const facts =
    offer.kind === "trial"
      ? [t("cta.note.trial", { minutes: TRIAL_MINUTES }), microphone, t("cta.note.phone")]
      : offer.kind === "pro"
        ? [
            t("cta.note.period", { count: offer.left, limit: offer.limit }),
            ...(offer.credits > 0 ? [t("cta.note.credits", { count: offer.credits })] : []),
            length,
            microphone,
          ]
        : offer.kind === "credits"
          ? [t("cta.note.creditsLeft", { count: offer.credits }), length, microphone]
          : null;
  const note = facts?.join(" · ") ?? null;

  if (variant === "compact") return control;

  const heading =
    offer.kind === "live"
      ? t("cta.heading.live")
      : offer.kind === "trial"
        ? t("cta.heading.trial", { jobTitle })
        : offer.kind === "needs-pro"
          ? t("cta.heading.needsPro")
          : offer.kind === "pro-exhausted"
            ? t("cta.heading.proExhausted")
            : rehearsed
              ? t("cta.heading.again")
              : t("cta.heading.first", { jobTitle });

  const lede =
    offer.kind === "live"
      ? t("cta.lede.live")
      : offer.kind === "trial"
        ? t("cta.lede.trial", { minutes: TRIAL_MINUTES })
        : offer.kind === "needs-pro"
          ? t("cta.lede.needsPro", { minutes: FULL_MINUTES, perMonth: PLANS.PRO.interviewsPerMonth })
          : offer.kind === "pro-exhausted"
            ? t("cta.lede.proExhausted", { date: resetDate(offer.resetsAt) })
            : rehearsed
              ? t("cta.lede.again")
              : t("cta.lede.first");

  return (
    <Surface as="section" aria-labelledby="interview-cta-title" className="mt-4 px-[clamp(20px,3.4vw,40px)] py-[clamp(28px,4vw,48px)]">
      <p className="cap">{t("cta.eyebrow")}</p>
      {/* Text, then the control under it: the column is too narrow to give a long label a column of its own. */}
      <div className="mt-4 min-w-0 max-w-[60ch]">
        <h2 id="interview-cta-title" className="display text-[clamp(30px,3.2vw,44px)] leading-[1.06] tracking-[-0.025em] text-balance">
          {heading}
        </h2>
        <p className="mt-4 text-lede text-ink-2">{lede}</p>
      </div>
      <div className="mt-8 flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        {control}
        {note && <p className="min-w-0 text-[15px] text-ink-2">{note}</p>}
      </div>
      {children && <div className="mt-10">{children}</div>}
    </Surface>
  );
}
