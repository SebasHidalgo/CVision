"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, Mic, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import { MAX_INTERVIEW_DURATION_SECONDS } from "@/lib/elevenlabs/limits";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import { countedAttempts, MAX_INTERVIEW_ATTEMPTS_PER_ANALYSIS } from "@/lib/interviewLimits";
import { interviewDestination, liveAttempt } from "@/lib/interviewStatus";
import { createInterviewAction } from "@/screens/ResumeAnalysisDetail/actions/createInterviewAction";
import type { ResumeAnalysis } from "@/types/resume";

type InterviewCtaProps = {
  resumeId: string;
  jobTitle: string;
  attempts: ResumeAnalysis["interviews"];
  /** "compact" sits in the header; "full" closes the report. */
  variant: "compact" | "full";
  /** The full variant's list of attempts, rendered by the server. */
  children?: React.ReactNode;
};

const MAX_MINUTES = Math.round(MAX_INTERVIEW_DURATION_SECONDS / 60);

/**
 * An analysis can be rehearsed up to the cap, one attempt at a time: the
 * control opens the live attempt when there is one, otherwise starts the
 * next, and at the cap says so instead.
 */
export default function InterviewCta({
  resumeId,
  jobTitle,
  attempts,
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

      toast.error(actionErrorCopy(result.code));
    } catch {
      // Rejected rather than returned: network drop, platform 413/504, or a
      // stale deployment.
      toast.error(actionErrorCopy("REQUEST_FAILED"));
    }

    setIsCreating(false);
  };

  const live = liveAttempt(attempts);
  const used = countedAttempts(attempts);
  const rehearsed = attempts.length > 0;
  const atCap = !live && used >= MAX_INTERVIEW_ATTEMPTS_PER_ANALYSIS;
  const usedLine = `${used} of ${MAX_INTERVIEW_ATTEMPTS_PER_ANALYSIS} rehearsals used`;

  const compactClasses = "h-11 gap-2 px-5";
  const fullClasses = "group h-12 gap-2 px-7 text-base";

  const control = live ? (
    <Button asChild className={variant === "compact" ? compactClasses : fullClasses}>
      <Link href={interviewDestination(live).href}>
        {interviewDestination(live).label}
        <ArrowRight className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
      </Link>
    </Button>
  ) : atCap ? (
    <p className="eyebrow flex h-11 items-center text-ink">{usedLine}</p>
  ) : (
    <Button
      onClick={handleCreate}
      disabled={isCreating}
      className={variant === "compact" ? compactClasses : fullClasses}
    >
      {isCreating ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Preparing the interview…
        </>
      ) : rehearsed ? (
        <>
          <RotateCcw className="size-4" />
          Rehearse again
        </>
      ) : (
        <>
          <Mic className="size-4" />
          Rehearse the interview
        </>
      )}
    </Button>
  );

  if (variant === "compact") return control;

  return (
    <section
      aria-labelledby="interview-cta-title"
      className="mt-6 border-t border-line pt-12 lg:pt-16"
    >
      <Eyebrow tick>Next</Eyebrow>
      <div className="mt-5 grid gap-8 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <h2 id="interview-cta-title" className="display-md text-ink">
            {live
              ? "Your interview is ready."
              : atCap
                ? "Every rehearsal of this posting is used."
                : rehearsed
                  ? "Rehearse it again."
                  : `Rehearse the ${jobTitle} interview out loud.`}
          </h2>
          <p className="lede mt-4 max-w-xl">
            {live
              ? "An attempt is waiting in the room. Finish it, and the feedback lands here."
              : atCap
                ? "Each rehearsal below is scored on its own. To rehearse this posting again, run a new analysis."
                : rehearsed
                  ? "Every attempt is scored on its own against the same posting and the same gaps, so you can see what changed."
                  : "A voice interviewer built from this exact posting asks the questions, you answer out loud, and when you end the call you get scored on five things, with the transcript."}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 md:col-span-4 md:items-end">
          {control}
          {!live && !atCap && (
            <p className="eyebrow">
              Needs a microphone · up to {MAX_MINUTES} minutes · works on a phone
              {rehearsed ? ` · ${usedLine}` : ""}
            </p>
          )}
        </div>
      </div>
      {children && <div className="mt-10">{children}</div>}
    </section>
  );
}
