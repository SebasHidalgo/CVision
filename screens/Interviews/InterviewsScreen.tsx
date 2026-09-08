import EmptyState from "@/components/layout/EmptyState";
import IndexRow from "@/components/layout/IndexRow";
import PageIntro from "@/components/layout/PageIntro";
import { fetchAllInterviews } from "@/lib/database/interview";
import { formatDate, ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";

const VISIBLE_TECH = 4;

export default async function InterviewsScreen() {
  const interviews = await fetchAllInterviews();
  const completed = interviews.filter((interview) => interview.finalized).length;

  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro
        eyebrow="Your interviews"
        title="Every rehearsal, on the record."
        aside={
          interviews.length > 0 && (
            <dl className="flex gap-10 md:gap-14">
              <div>
                <dt className="eyebrow">Interviews</dt>
                <dd className="figure mt-3 text-5xl text-ink">
                  {interviews.length}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Completed</dt>
                <dd className="figure mt-3 text-5xl text-ink">{completed}</dd>
              </div>
            </dl>
          )
        }
      />

      {interviews.length === 0 ? (
        <EmptyState
          title="No rehearsals yet."
          body="Interviews start from an analysis, so the questions come from the actual job post you are applying to."
          action={{ href: "/resume/analyses", label: "Pick an analysis" }}
        />
      ) : (
        <ol className="divide-y divide-line border-b border-line">
          {interviews.map((interview, i) => {
            const hidden = interview.techstack.length - VISIBLE_TECH;

            return (
              <IndexRow
                key={interview.id}
                index={ordinal(i)}
                // A finished interview opens its feedback; an unfinished one,
                // the room.
                href={
                  interview.finalized
                    ? `/interview/${interview.id}/feedback`
                    : `/interview/${interview.id}`
                }
                title={interview.role}
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
                meta={formatDate(interview.createdAt)}
                reading={
                  <p className="flex items-center gap-3 text-sm font-medium text-ink">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 rounded-full",
                        interview.finalized ? "bg-strong" : "bg-signal animate-blink",
                      )}
                    />
                    {interview.finalized ? "Completed · view feedback" : "Ready to start"}
                  </p>
                }
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}
