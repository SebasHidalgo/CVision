import type { TFunction } from "i18next";
import Link from "next/link";
import { textLinkClass } from "@/components/design-system/Button";
import { InkMark, type InkMarkShape } from "@/components/interview/feedback/parts";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { interviewDestination } from "@/lib/interviewStatus";
import { scoreTone, toneKey } from "@/lib/score";
import { cn } from "@/lib/utils";
import type { InterviewListItem } from "@/types/interview";
import { timeLeft, type ListState } from "../utils/listState";

/** Shared with the skeleton: stacked below 1024 px, the state beside the title from there. */
export const ROW_GRID =
  "grid grid-cols-[28px_minmax(0,1fr)_20px] gap-x-3 gap-y-4 px-4 py-5 sm:grid-cols-[40px_minmax(0,1fr)_20px] sm:gap-x-5 sm:px-6 " +
  "[grid-template-areas:'n_title_go'_'n_state_.'] " +
  "lg:grid-cols-[40px_minmax(0,1.4fr)_minmax(0,1fr)_20px] lg:gap-x-8 lg:py-6 lg:[grid-template-areas:'n_title_state_go']";

/**
 * The mark of a row's state, by shape: filled once scored, half while something is under way (a call to continue,
 * feedback on its way), empty while it waits to start, dashed when it can't go on, a beating dot while a call may be live.
 */
const SHAPE: Record<Exclude<ListState["kind"], "live">, InkMarkShape> = {
  done: "full",
  pending: "half",
  saving: "half",
  resumable: "half",
  ready: "empty",
  needsPro: "dashed",
  needsPack: "dashed",
  noStarts: "dashed",
  failed: "dashed",
  expired: "dashed",
};

function reading(state: ListState, t: TFunction<"interview">): string {
  switch (state.kind) {
    case "resumable":
      return t(state.early ? "list.reading.endedEarly" : "list.reading.dropped", { time: timeLeft(state.secondsLeft) });
    case "done":
      return state.score === null ? t("list.reading.completed") : t("list.reading.scored", { score: state.score });
    default:
      return t(`list.reading.${state.kind}`);
  }
}

type InterviewRowProps = {
  interview: InterviewListItem;
  state: ListState;
  n: string;
  locale: Locale;
  t: TFunction<"interview">;
  common: TFunction<"common">;
};

/**
 * One interview in the list: when, which role at which company and which attempt, where it stands, and its analysis.
 * The role is the row's link (to the room while it waits, to the feedback after); its hit area covers the row, and the
 * analysis link sits above it.
 */
export function InterviewRow({ interview, state, n, locale, t, common }: InterviewRowProps) {
  const destination = interviewDestination(interview);
  const label = reading(state, t);
  const scored = state.kind === "done" && state.score !== null ? state.score : null;
  const tone = scored !== null ? common(toneKey("performance", scoreTone(scored))) : null;

  return (
    <li
      data-interview-row
      data-state={state.kind}
      className={cn(
        ROW_GRID,
        "group relative transition-colors duration-200 hover:bg-ed-raise motion-reduce:transition-none",
        "has-[[data-row-link]:focus-visible]:outline-2 has-[[data-row-link]:focus-visible]:outline-offset-[-2px] has-[[data-row-link]:focus-visible]:outline-ed-ink",
      )}
    >
      <span aria-hidden className="ed-mono pt-[3px] text-[13px] text-ed-ink-3 [grid-area:n]">
        {n}
      </span>

      <div className="min-w-0 [grid-area:title]">
        <p className="ed-mono text-[13px] text-ed-ink-3">
          <time dateTime={interview.createdAt.toISOString()}>{formatDate(interview.createdAt, locale)}</time>
          <span aria-hidden> · </span>
          {t("list.attempt", { number: interview.attemptNumber })}
        </p>
        <h2 className="mt-1.5 text-[20px] leading-tight font-semibold tracking-[-0.01em] break-words text-ed-ink">
          <Link
            href={destination.href}
            data-row-link
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {interview.role}
            <span className="sr-only">
              {" · "}
              {label}
              {tone && ` · ${tone}`}
            </span>
          </Link>
        </h2>
        {interview.companyName && <p className="mt-1 break-words text-ed-ink-2">{interview.companyName}</p>}
      </div>

      <div className="min-w-0 [grid-area:state]">
        {scored !== null ? (
          <p aria-hidden className="flex items-baseline gap-3">
            <span className="font-ed-display text-[30px] leading-none font-light tracking-[-0.03em] tabular-nums text-ed-ink">{scored}</span>
            <span className="text-ed-ink">{tone}</span>
          </p>
        ) : (
          <p aria-hidden className="flex items-start gap-2.5 text-ed-ink">
            <span className="flex h-lh shrink-0 items-center">
              {state.kind === "live" ? (
                <span className="size-2.5 rounded-full bg-ed-ink motion-safe:animate-pulse" />
              ) : (
                <InkMark shape={SHAPE[state.kind]} />
              )}
            </span>
            {label}
          </p>
        )}
        {interview.analysisId && (
          <Link href={`/resume/analysis/${interview.analysisId}`} className={cn(textLinkClass, "relative z-10 -mb-2 text-ed-small")}>
            {t("list.openAnalysis")}
            <span className="sr-only">
              {" · "}
              {interview.role}
              {interview.companyName ? `, ${interview.companyName}` : ""}
            </span>
          </Link>
        )}
      </div>

      <svg
        aria-hidden
        width="16"
        height="16"
        viewBox="0 0 16 16"
        className="mt-1 text-ed-ink-3 transition-[color,translate] duration-200 ease-ed-out [grid-area:go] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ed-ink motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0"
      >
        <path d="M4.5 11.5l7-7M6 4.5h5.5V10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </li>
  );
}
