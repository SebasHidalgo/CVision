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

/** The dot beside an attempt's state, by phase; done attempts show their score. */
const DOT: Record<Exclude<InterviewPhase, "done">, string> = {
  ready: "glow-signal bg-signal animate-blink",
  pending: "bg-fair animate-blink",
  failed: "bg-weak",
  expired: "bg-ink-3",
};

/** The rehearsals of one analysis, newest first, each a link to where it stands. */
export default function InterviewAttempts({ attempts, t, locale, entitlement }: InterviewAttemptsProps) {
  if (attempts.length === 0) return null;

  return (
    <ol aria-label={t("attempts.label")} className="divide-y divide-line border-y border-line">
      {attempts.map((attempt) => {
        const destination = interviewDestination(attempt);
        const phase = destination.phase;
        const reading = phase === "ready" ? waitingReading(waitingInterviewEntry(attempt, entitlement, MAX_INTERVIEW_STARTS)) : null;
        return (
          <li key={attempt.id}>
            <Link
              href={destination.href}
              className="group -mx-3 grid grid-cols-[1fr_auto_1.5rem] items-center gap-x-4 px-3 py-4 transition-colors duration-200 hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-none sm:grid-cols-[7rem_1fr_auto_1.5rem]"
            >
              <span className="eyebrow text-ink">{t("attempts.attempt", { number: attempt.attemptNumber })}</span>
              <span className="eyebrow col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                {formatDate(attempt.createdAt, locale)}
              </span>
              <span className="flex items-center gap-3 text-sm font-medium text-ink">
                {phase === "done" ? (
                  <>
                    <span aria-hidden className="size-2 rounded-full bg-strong" />
                    {attempt.totalScore === null
                      ? t("attempts.completed")
                      : t("attempts.scored", { score: attempt.totalScore })}
                  </>
                ) : (
                  <>
                    <span aria-hidden className={cn("size-2 rounded-full", reading && reading !== "ready" ? "bg-ink-3" : DOT[phase])} />
                    {t(`attempts.reading.${reading ?? phase}`)}
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
