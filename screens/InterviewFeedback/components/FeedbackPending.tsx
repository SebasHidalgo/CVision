import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import type { InterviewStatusSnapshot } from "@/lib/schemas/interviewSessionSchema";
import StatusPoller from "./StatusPoller";

type FeedbackPendingProps = {
  interviewId: string;
  role: string;
  date: string;
  /**
   * "transcript": the call just ended and the platform has not delivered the
   * transcript yet. "scoring": the transcript is stored and being read.
   */
  waitingFor: "transcript" | "scoring";
  /** What this render is based on; the poller re-renders when it changes. */
  seen: Pick<InterviewStatusSnapshot, "status" | "hasFeedback" | "failureReason">;
};

/** Shown while the interview is being saved or scored; polls until it is. */
export default function FeedbackPending({ interviewId, role, date, waitingFor, seen }: FeedbackPendingProps) {
  return (
    <article className="wrap py-10 lg:py-14">
      <StatusPoller interviewId={interviewId} seen={seen} />
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>Interview feedback · {date}</Eyebrow>
        <p className="mt-6 text-lg text-ink-2">Mock interview</p>
        <h1 className="display-lg mt-1 text-ink">{role}</h1>
      </header>

      <section className="py-12 lg:py-16" role="status" aria-live="polite">
        <p className="flex items-center gap-3 text-lg text-ink">
          <Loader2 aria-hidden className="size-5 animate-spin text-signal" />
          {waitingFor === "transcript" ? "Saving your interview." : "Preparing your feedback."}
        </p>
        <p className="lede mt-4 max-w-xl">
          {waitingFor === "transcript"
            ? "The transcript usually arrives within a minute of the call ending, then it is read against the posting and the gaps your analysis found. The page updates by itself."
            : "The transcript is being read against the posting and the gaps your analysis found. This usually takes under a minute; the page updates by itself."}
        </p>
        <p className="mt-6 text-sm text-ink-3">
          You can leave this page; the result will be waiting under Interviews.
        </p>
        <Link
          href="/interviews"
          className="link-rule mt-10 inline-flex items-center gap-2 px-2 text-sm text-ink-2"
        >
          <ArrowLeft className="size-4" />
          All interviews
        </Link>
      </section>
    </article>
  );
}
