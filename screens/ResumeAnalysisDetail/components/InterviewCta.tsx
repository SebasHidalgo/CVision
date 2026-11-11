"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, Mic, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import { useErrorCopy, useResetDate } from "@/hooks/useErrorCopy";
import { attemptRan, interviewDestination, liveAttempt } from "@/lib/interviewStatus";
import { AGENT_SECONDS } from "@/lib/interviewEntitlement";
import { INTERVIEW_PACK_CREDITS, PLANS, type InterviewQuotaView } from "@/lib/plans";
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

export default function InterviewCta({
  resumeId,
  jobTitle,
  attempts,
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

  const live = liveAttempt(attempts);
  // "Again" only after a rehearsal that ran: an expired or never-answered attempt was not one.
  const rehearsed = attempts.some(attemptRan);
  const offer = interviewOffer(quota, live !== null);

  // Labels wrap inside the button instead of overflowing it: a nowrap label is a min-content width
  // that pushes the button over the text beside it (the Spanish trial label did).
  const sharedClasses = "h-auto max-w-full gap-2 whitespace-normal text-center";
  const compactClasses = `${sharedClasses} min-h-11 px-5 py-2`;
  const fullClasses = `${sharedClasses} group min-h-12 px-5 py-3 text-base sm:px-7`;
  const buttonClasses = variant === "compact" ? compactClasses : fullClasses;

  const startButton = (label: string, icon: React.ReactNode) => (
    <Button onClick={handleCreate} disabled={isCreating} className={buttonClasses}>
      {isCreating ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {t("cta.preparing")}
        </>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </Button>
  );

  // A live attempt is always in the "ready" phase: its link goes to the room.
  const control = live ? (
    <Button asChild className={buttonClasses}>
      <Link href={interviewDestination(live).href}>
        {t("cta.openRoom")}
        <ArrowRight className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
      </Link>
    </Button>
  ) : offer.kind === "trial" ? (
    startButton(t("cta.tryTrial", { minutes: TRIAL_MINUTES }), <Mic className="size-4" />)
  ) : offer.kind === "pro" || offer.kind === "credits" ? (
    startButton(
      rehearsed ? t("cta.rehearseAgain") : t("cta.rehearse"),
      rehearsed ? <RotateCcw className="size-4" /> : <Mic className="size-4" />,
    )
  ) : offer.kind === "pro-exhausted" ? (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <p className="text-sm font-medium text-ink">
        {errorCopy("INTERVIEW_QUOTA_EXCEEDED", { plan: "PRO", resetsAt: offer.resetsAt })}
      </p>
      <Link href="/account/billing" className="link-rule text-sm text-ink-2">
        {t("cta.getMore", { count: INTERVIEW_PACK_CREDITS })}
      </Link>
    </div>
  ) : (
    <p className="flex min-h-11 min-w-0 items-center text-sm font-medium text-ink">
      {errorCopy("INTERVIEW_QUOTA_EXCEEDED", { plan: "FREE" })}
    </p>
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
    <section
      aria-labelledby="interview-cta-title"
      className="mt-6 border-t border-line pt-12 lg:pt-16"
    >
      <Eyebrow tick>{t("cta.eyebrow")}</Eyebrow>
      {/* Text, then the control under it: the section is at most ~48rem wide, too narrow to give a long label a column of its own. */}
      <div className="mt-5 min-w-0 max-w-2xl">
        <h2 id="interview-cta-title" className="display-md text-ink">
          {heading}
        </h2>
        <p className="lede mt-4 max-w-xl">{lede}</p>
      </div>
      <div className="mt-8 flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        {control}
        {note && <p className="eyebrow min-w-0">{note}</p>}
      </div>
      {children && <div className="mt-10">{children}</div>}
    </section>
  );
}
