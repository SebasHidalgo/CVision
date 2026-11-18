import type { TFunction } from "i18next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import type { InterviewEntitlement } from "@/lib/interviewEntitlement";
import { waitingInterviewEntry, waitingReading } from "@/lib/interviewEntry";
import { MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { interviewDestination, type InterviewPhase } from "@/lib/interviewStatus";
import { cn } from "@/lib/utils";
import type { InterviewAttempt } from "@/types/resume";

type InterviewAttemptsProps = {
  attempts: InterviewAttempt[];
  /** The screen's: this renders on the server, inside a client component's children. */
  t: TFunction<"analysis">;
  locale: Locale;
  /** What a fresh start would get: a waiting attempt the plan cannot start says so, as its room does. */
  entitlement: InterviewEntitlement;
};

/** The mark beside an attempt's state: shape, in ink (the state is written next to it). A waiting one pulses. */
const MARK: Record<InterviewPhase | "blocked", string> = {
  done: "bg-ed-ink",
  ready: "border-[1.5px] border-ed-ink animate-pulse",
  pending: "bg-ed-ink-2 animate-pulse",
  failed: "border-[1.5px] border-ed-ink-3",
  expired: "border-[1.5px] border-dashed border-ed-ink-3",
  blocked: "border-[1.5px] border-ed-ink-3",
};

/** The rehearsals of one analysis, newest first, each a link to where it stands. */
export default function InterviewAttempts({ attempts, t, locale, entitlement }: InterviewAttemptsProps) {
  if (attempts.length === 0) return null;

  return (
    <ol aria-label={t("attempts.label")} className="border-t border-ed-line">
      {attempts.map((attempt) => {
        const destination = interviewDestination(attempt);
        const phase = destination.phase;
        const reading = phase === "ready" ? waitingReading(waitingInterviewEntry(attempt, entitlement, MAX_INTERVIEW_STARTS)) : null;
        const mark = reading && reading !== "ready" ? "blocked" : phase;
        return (
          <li key={attempt.id} className="border-b border-ed-line">
            <Link
              href={destination.href}
              className="group -mx-3 grid min-h-14 grid-cols-[minmax(0,1fr)_auto_1.25rem] items-center gap-x-4 gap-y-0.5 rounded-ed-field px-3 py-3.5 transition-colors duration-200 hover:bg-ed-raise sm:grid-cols-[8rem_minmax(0,1fr)_auto_1.25rem]"
            >
              <span className="text-ed-body font-semibold text-ed-ink">{t("attempts.attempt", { number: attempt.attemptNumber })}</span>
              <span className="col-span-2 row-start-2 text-[15px] text-ed-ink-2 sm:col-span-1 sm:row-start-auto">
                {formatDate(attempt.createdAt, locale)}
              </span>
              <span className="flex items-center gap-2.5 text-[15px] font-medium text-ed-ink">
                <span aria-hidden className={cn("size-2 flex-none rounded-full", MARK[mark])} />
                {phase === "done"
                  ? attempt.totalScore === null
                    ? t("attempts.completed")
                    : t("attempts.scored", { score: attempt.totalScore })
                  : t(`attempts.reading.${reading ?? phase}`)}
              </span>
              <ArrowUpRight
                aria-hidden
                className="size-4 justify-self-end text-ed-ink-3 transition-[transform,color] duration-300 ease-ed-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ed-ink motion-reduce:transition-none"
              />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
