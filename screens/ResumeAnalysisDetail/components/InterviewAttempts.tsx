import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatDate } from "@/lib/format";
import { interviewDestination, type InterviewPhase } from "@/lib/interviewStatus";
import { cn } from "@/lib/utils";
import type { InterviewAttempt } from "@/types/resume";

type InterviewAttemptsProps = {
  attempts: InterviewAttempt[];
};

/** What an attempt's row says on the right, by phase; done attempts show their score. */
const READING: Record<Exclude<InterviewPhase, "done">, { text: string; dot: string }> = {
  ready: { text: "Not finished", dot: "glow-signal bg-signal animate-blink" },
  pending: { text: "Preparing feedback", dot: "bg-fair animate-blink" },
  failed: { text: "Didn't complete", dot: "bg-weak" },
  expired: { text: "Expired", dot: "bg-ink-3" },
};

/** The rehearsals of one analysis, newest first, each a link to where it stands. */
export default function InterviewAttempts({ attempts }: InterviewAttemptsProps) {
  if (attempts.length === 0) return null;

  return (
    <ol aria-label="Interview attempts" className="divide-y divide-line border-y border-line">
      {attempts.map((attempt) => {
        const destination = interviewDestination(attempt);
        const reading =
          destination.phase === "done"
            ? null
            : READING[destination.phase];
        return (
          <li key={attempt.id}>
            <Link
              href={destination.href}
              className="group -mx-3 grid grid-cols-[1fr_auto_1.5rem] items-center gap-x-4 px-3 py-4 transition-colors duration-200 hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-none sm:grid-cols-[7rem_1fr_auto_1.5rem]"
            >
              <span className="eyebrow text-ink">Attempt {attempt.attemptNumber}</span>
              <span className="eyebrow col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                {formatDate(attempt.createdAt)}
              </span>
              <span className="flex items-center gap-3 text-sm font-medium text-ink">
                {reading ? (
                  <>
                    <span aria-hidden className={cn("size-2 rounded-full", reading.dot)} />
                    {reading.text}
                  </>
                ) : (
                  <>
                    <span aria-hidden className="size-2 rounded-full bg-strong" />
                    {attempt.totalScore === null ? "Completed" : `Scored ${attempt.totalScore}`}
                  </>
                )}
              </span>
              <ArrowUpRight
                aria-hidden
                className="size-4 justify-self-end text-ink-3 transition-all duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink"
              />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
