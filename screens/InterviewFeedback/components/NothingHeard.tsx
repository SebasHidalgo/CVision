import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";

type NothingHeardProps = {
  interview: { id: string; role: string };
  attemptsLeft: number;
  date: string;
};

/**
 * The call ended and the platform heard nothing from the candidate. The
 * interview is still startable, so the way forward is the room, not a retry
 * of the scoring.
 */
export default function NothingHeard({ interview, attemptsLeft, date }: NothingHeardProps) {
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
          The interviewer never heard you.
        </p>
        <p className="lede mt-4 max-w-xl">
          The call ended without a single answer from you, which usually means
          the microphone was muted or not allowed. Nothing was scored and the
          attempt is not wasted beyond itself: you have {attemptsLeft}{" "}
          {attemptsLeft === 1 ? "attempt" : "attempts"} left.
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
