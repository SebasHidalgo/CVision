import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";

type AttemptNotScoredProps = {
  interview: { id: string; role: string };
  /** "silent": the platform heard nothing. "lost": it has no record of the session. "failed": it could not run the call. */
  reason: "silent" | "lost" | "failed";
  /** Starts (connections) this interview can still issue. */
  startsLeft: number;
  date: string;
};

const COPY = {
  silent: {
    title: "The interviewer never heard you.",
    body: "The call ended without a single answer from you, which usually means the microphone was muted or not allowed. Nothing was scored.",
  },
  lost: {
    title: "That session never reached the interviewer.",
    body: "The voice platform has no record of the call, so there is nothing to score. This happens when the connection failed before the interview started.",
  },
  failed: {
    title: "The interviewer couldn't join the call.",
    body: "Nothing was charged, and this didn't use one of your starts. The voice platform could not run the call: a problem on our side, not with your microphone.",
  },
};

/** What the start that just ended did to the count: a call the platform could not run is given back. */
const STARTS_COPY = {
  silent: "That start counts, but the interview is still yours:",
  lost: "That start counts, but the interview is still yours:",
  failed: "The interview is still yours:",
};

/**
 * The latest call produced nothing to score and the interview is still
 * startable, so the way forward is the room, not a retry of the scoring.
 */
export default function AttemptNotScored({ interview, reason, startsLeft, date }: AttemptNotScoredProps) {
  const copy = COPY[reason];

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
        <p className="lede mt-4 max-w-xl">
          {copy.body} {STARTS_COPY[reason]} you have {startsLeft} {startsLeft === 1 ? "start" : "starts"} left.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button asChild className="h-11 gap-2 px-5">
            <Link href={`/interview/${interview.id}`}>
              Back to the room
              <ArrowRight className="size-4" />
            </Link>
          </Button>
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
