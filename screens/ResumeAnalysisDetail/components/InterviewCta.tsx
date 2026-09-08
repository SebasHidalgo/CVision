"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, Mic } from "lucide-react";
import { toast } from "sonner";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import { createInterviewAction } from "@/screens/ResumeAnalysisDetail/actions/createInterviewAction";
import type { ResumeAnalysis } from "@/types/resume";

type InterviewCtaProps = {
  resumeId: string;
  jobTitle: string;
  interview: ResumeAnalysis["interview"];
  /** "compact" sits in the header; "full" closes the report. */
  variant: "compact" | "full";
};

/**
 * One analysis owns at most one interview, so the action changes with state:
 * create it, open the room, or read the feedback.
 */
export default function InterviewCta({
  resumeId,
  jobTitle,
  interview,
  variant,
}: InterviewCtaProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    setIsCreating(true);

    const result = await createInterviewAction({ resumeId });

    if (!result.ok) {
      // Reset the button instead of navigating to /interview/undefined.
      setIsCreating(false);
      toast.error(actionErrorCopy(result.code));
      return;
    }

    router.push(`/interview/${result.data.interviewId}`);
  };

  const target = interview
    ? interview.finalized
      ? { href: `/interview/${interview.id}/feedback`, label: "Read interview feedback" }
      : { href: `/interview/${interview.id}`, label: "Open the interview room" }
    : null;

  const compactClasses = "h-11 gap-2 px-5";
  const fullClasses = "group h-12 gap-2 px-7 text-base";

  const control = target ? (
    <Button asChild className={variant === "compact" ? compactClasses : fullClasses}>
      <Link href={target.href}>
        {target.label}
        <ArrowRight className="size-4 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
      </Link>
    </Button>
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
            {target?.href.endsWith("/feedback")
              ? "You already rehearsed this one."
              : `Rehearse the ${jobTitle} interview out loud.`}
          </h2>
          <p className="lede mt-4 max-w-xl">
            {target?.href.endsWith("/feedback")
              ? "Your transcript, recording and scores are waiting in the feedback report."
              : "A voice interviewer built from this exact posting asks the questions, you answer, and you get scored on five things when you hang up."}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 md:col-span-4 md:items-end">
          {control}
          {!target && (
            <p className="eyebrow">Needs a microphone · takes a few seconds to set up</p>
          )}
        </div>
      </div>
    </section>
  );
}
