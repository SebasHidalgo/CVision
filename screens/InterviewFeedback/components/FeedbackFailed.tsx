import Link from "next/link";
import type { InterviewStatus } from "@prisma/client";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import { failureCopy } from "../utils/failureCopy";
import RetryFeedbackButton from "./RetryFeedbackButton";

type FeedbackFailedProps = {
  interview: {
    id: string;
    role: string;
    status: InterviewStatus;
    failureReason: string | null;
    startCount: number;
  };
  date: string;
};

/** FAILED and EXPIRED, in plain words, with whatever is left to do. */
export default function FeedbackFailed({ interview, date }: FeedbackFailedProps) {
  const copy = failureCopy(interview.status, interview.failureReason);

  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>Interview feedback · {date}</Eyebrow>
        <p className="mt-6 text-lg text-ink-2">Mock interview</p>
        <h1 className="display-lg mt-1 text-ink">{interview.role}</h1>
      </header>

      <section className="py-12 lg:py-16">
        <p className="flex items-center gap-3 text-lg text-ink">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-weak" />
          {copy.title}
        </p>
        <p className="lede mt-4 max-w-xl">{copy.body}</p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {copy.canRetryFeedback ? (
            <RetryFeedbackButton interviewId={interview.id} />
          ) : (
            <Button asChild className="h-11 gap-2 px-5">
              <Link href="/resume/analyses">
                Pick an analysis
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          )}
          <Link
            href="/interviews"
            className="link-rule inline-flex items-center gap-2 px-2 text-sm text-ink-2"
          >
            <ArrowLeft className="size-4" />
            All interviews
          </Link>
        </div>
      </section>
    </article>
  );
}
