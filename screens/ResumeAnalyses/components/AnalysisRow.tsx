import type { TFunction } from "i18next";
import Link from "next/link";
import { StatusMark, type MarkStatus } from "@/components/design-system/StatusMark";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { tallyCopy } from "@/lib/i18n/tally";
import type { InterviewEntitlement } from "@/lib/interviewEntitlement";
import { deriveFitVerdict } from "@/lib/schemas/resumeSchema";
import { toneKey } from "@/lib/score";
import { cn } from "@/lib/utils";
import { attemptSummary } from "@/screens/ResumeAnalyses/utils/attemptSummary";
import { requirementMarks } from "@/screens/ResumeAnalyses/utils/requirementMarks";
import type { ResumeAnalysis } from "@/types/resume";
import { DeleteUnreadable } from "./DeleteUnreadable";

/** Shared with the skeleton: stacked below 1024 px, four columns and the arrow above. */
export const ROW_GRID =
  "grid grid-cols-[28px_minmax(0,1fr)_20px] gap-x-3 gap-y-5 px-4 py-5 sm:grid-cols-[40px_minmax(0,1fr)_20px] sm:gap-x-5 sm:px-6 " +
  "[grid-template-areas:'n_title_go'_'n_fit_.'_'n_int_.'] " +
  "lg:grid-cols-[40px_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.85fr)_20px] lg:gap-x-8 lg:py-6 lg:[grid-template-areas:'n_title_fit_int_go']";

type AnalysisRowProps = {
  analysis: ResumeAnalysis;
  n: string;
  locale: Locale;
  t: TFunction<"analyses">;
  common: TFunction<"common">;
  /** What a fresh start would get; null when nothing on the page waits to start. */
  entitlement: InterviewEntitlement | null;
  /** The page heading's id, for focus after deleting an unreadable row. */
  headingId: string;
};

function Marks({ marks }: { marks: MarkStatus[] }) {
  return marks.map((status, i) => <StatusMark key={i} status={status} />);
}

/** One analysis in the ledger: when, which job, the verdict with its arithmetic, and where its interview stands. */
export function AnalysisRow({ analysis, n, locale, t, common, entitlement, headingId }: AnalysisRowProps) {
  const date = formatDate(analysis.createdAt, locale);
  const summary = attemptSummary(analysis.interviews, entitlement);

  const title = (
    <div className="min-w-0 [grid-area:title]">
      <p className="ed-mono text-[13px] text-ed-ink-3">
        <time dateTime={analysis.createdAt}>{date}</time>
      </p>
      <h2 className="mt-1.5 text-[20px] leading-tight font-semibold tracking-[-0.01em] break-words text-ed-ink">{analysis.companyName}</h2>
      <p className="mt-1 break-words text-ed-ink-2">{analysis.jobTitle}</p>
    </div>
  );
  const number = (
    <span aria-hidden className="ed-mono pt-[3px] text-[13px] text-ed-ink-3 [grid-area:n]">
      {n}
    </span>
  );

  // Stored feedback outside the schema: no verdict, no page to open (it redirects here), so delete lives on the row.
  if (!analysis.feedback) {
    return (
      <li data-analysis-row className={ROW_GRID}>
        {number}
        {title}
        <p className="text-ed-ink-2 [grid-area:fit]">{t("row.unreadable")}</p>
        <div className="[grid-area:int]">
          <DeleteUnreadable resumeId={analysis.id} jobTitle={analysis.jobTitle} companyName={analysis.companyName} date={date} returnFocusTo={headingId} />
        </div>
      </li>
    );
  }

  const verdict = deriveFitVerdict(analysis.feedback);
  const marks = requirementMarks(analysis.feedback);

  return (
    <li data-analysis-row>
      <Link
        href={`/resume/analysis/${analysis.id}`}
        className={cn(ROW_GRID, "group transition-colors duration-200 hover:bg-ed-raise focus-visible:outline-offset-[-2px] motion-reduce:transition-none")}
      >
        {number}
        {title}
        <div className="[grid-area:fit]">
          <p className="font-ed-display text-[26px] leading-none font-normal tracking-[-0.02em] text-ed-ink [font-variation-settings:'opsz'_72,'SOFT'_0,'WONK'_0]">
            {common(toneKey("fit", verdict.tone))}
          </p>
          <span aria-hidden className="mt-3 flex flex-wrap items-center gap-[5px]">
            <Marks marks={marks.required} />
            {marks.preferred.length > 0 && <span className="mx-1.5 h-3.5 w-px bg-ed-line-2" />}
            <Marks marks={marks.preferred} />
          </span>
          <p className="ed-mono mt-2.5 text-[13.5px] leading-snug text-ed-ink-2">{tallyCopy(common, verdict.tally)}</p>
        </div>
        <div className="[grid-area:int]">
          <p className="ed-cap">{t("row.interview")}</p>
          {summary ? (
            <p className="mt-1.5 text-ed-ink">
              {t("row.attempt", { number: summary.number })}
              <span aria-hidden className="text-ed-ink-3"> · </span>
              {summary.reading === "scored" ? t("row.reading.scored", { score: summary.score }) : t(`row.reading.${summary.reading}`)}
              {summary.earlier > 0 && <span className="block text-ed-small text-ed-ink-2">{t("row.earlier", { count: summary.earlier })}</span>}
            </p>
          ) : (
            <p className="mt-1.5 text-ed-ink-2">{t("row.noInterview")}</p>
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
      </Link>
    </li>
  );
}
