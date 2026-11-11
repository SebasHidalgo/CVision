import { HistoryLine } from "@/components/billing/HistoryNotice";
import EmptyState from "@/components/layout/EmptyState";
import IndexRow from "@/components/layout/IndexRow";
import PageIntro from "@/components/layout/PageIntro";
import { fetchVisibleInterviews } from "@/lib/database/interview";
import { formatDate, ordinal } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { interviewDestination, type InterviewPhase } from "@/lib/interviewStatus";
import { cn } from "@/lib/utils";

const VISIBLE_TECH = 4;

/** The reading on the right of each row, by phase. */
const READING: Record<InterviewPhase, { key: `list.reading.${InterviewPhase}`; dot: string }> = {
  ready: { key: "list.reading.ready", dot: "glow-signal bg-signal animate-blink" },
  pending: { key: "list.reading.pending", dot: "bg-fair animate-blink" },
  done: { key: "list.reading.done", dot: "bg-strong" },
  failed: { key: "list.reading.failed", dot: "bg-weak" },
  expired: { key: "list.reading.expired", dot: "bg-ink-3" },
};

export default async function InterviewsScreen() {
  // An interview follows its analysis: hidden analyses hide their rehearsals too.
  const [{ interviews, hidden }, t, locale] = await Promise.all([fetchVisibleInterviews(), getT("interview"), getLocale()]);
  const completed = interviews.filter((interview) => interview.status === "COMPLETED").length;

  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro
        eyebrow={t("list.eyebrow")}
        title={t("list.title")}
        aside={
          interviews.length > 0 && (
            <dl className="flex gap-10 md:gap-14">
              <div>
                <dt className="eyebrow">{t("list.count")}</dt>
                <dd className="figure mt-3 text-5xl text-ink">
                  {interviews.length}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">{t("list.completed")}</dt>
                <dd className="figure mt-3 text-5xl text-ink">{completed}</dd>
              </div>
            </dl>
          )
        }
      />

      {interviews.length === 0 && hidden === 0 ? (
        <EmptyState
          title={t("list.emptyTitle")}
          body={t("list.emptyBody")}
          action={{ href: "/resume/analyses", label: t("list.emptyAction") }}
        />
      ) : (
        <ol className="divide-y divide-line border-b border-line">
          {interviews.map((interview, i) => {
            const hidden = interview.techstack.length - VISIBLE_TECH;
            const destination = interviewDestination(interview);
            const reading = READING[destination.phase];

            return (
              <IndexRow
                key={interview.id}
                index={ordinal(i)}
                href={destination.href}
                title={
                  <>
                    {interview.role}
                    <span className="eyebrow ml-3 align-middle">{t("list.attempt", { number: interview.attemptNumber })}</span>
                  </>
                }
                subtitle={
                  interview.techstack.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {interview.techstack.slice(0, VISIBLE_TECH).map((tech) => (
                        <span
                          key={tech}
                          className="border border-line px-1.5 py-px font-mono text-[11px] text-ink-2"
                        >
                          {tech}
                        </span>
                      ))}
                      {hidden > 0 && (
                        <span className="px-1 py-px font-mono text-[11px] text-ink-3">
                          +{hidden}
                        </span>
                      )}
                    </span>
                  ) : undefined
                }
                meta={formatDate(interview.createdAt, locale)}
                reading={
                  <p className="flex items-center gap-3 text-sm font-medium text-ink">
                    <span aria-hidden className={cn("size-2 rounded-full", reading.dot)} />
                    {t(reading.key)}
                  </p>
                }
              />
            );
          })}
        </ol>
      )}
      <HistoryLine hidden={hidden} what="interviews" />
    </div>
  );
}
