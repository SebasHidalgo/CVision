import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { Surface } from "@/components/design-system/Surface";
import { fetchVisibleInterviews } from "@/lib/database/interview";
import { currentInterviewEntitlement } from "@/lib/database/usage";
import { ordinal } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { EmptyList } from "./components/EmptyList";
import { HistoryLine } from "./components/HistoryLine";
import { InterviewRow } from "./components/InterviewRow";
import { PlanLine } from "./components/PlanLine";
import { listState } from "./utils/listState";
import { planLine } from "./utils/planLine";

const HEADING_ID = "interviews-title";

export default async function InterviewsScreen() {
  // An interview follows its analysis: hidden analyses hide their rehearsals too. The list's read sweeps abandoned
  // interviews first, so the entitlement after it counts their refunds.
  const [{ interviews, hidden }, t, common, locale] = await Promise.all([fetchVisibleInterviews(), getT("interview"), getT("common"), getLocale()]);
  // What the plan has left: the line under the heading, and whether a waiting interview can start.
  const entitlement = await currentInterviewEntitlement();
  const now = new Date();
  const completed = interviews.filter((interview) => interview.status === "COMPLETED").length;

  return (
    <div className={cn("ed-root flex-1", fontText.variable)}>
      <div className="ed-wrap pt-[clamp(40px,6vw,88px)] pb-ed-section">
        <PageHeading
          id={HEADING_ID}
          ruled
          title={t("list.title")}
          aside={
            interviews.length > 0 && (
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <div className="flex items-baseline gap-2.5">
                  <dt className="text-ed-small text-ed-ink-2">{t("list.count")}</dt>
                  <dd className="ed-mono text-[17px] text-ed-ink">{interviews.length}</dd>
                </div>
                <div className="flex items-baseline gap-2.5">
                  <dt className="text-ed-small text-ed-ink-2">{t("list.completed")}</dt>
                  <dd className="ed-mono text-[17px] text-ed-ink">{completed}</dd>
                </div>
              </dl>
            )
          }
        />
        <PlanLine line={planLine(entitlement)} t={t} common={common} locale={locale} />

        {interviews.length === 0 ? (
          hidden === 0 && <EmptyList title={t("list.emptyTitle")} body={t("list.emptyBody")} action={{ href: "/resume/analyses", label: t("list.emptyAction") }} />
        ) : (
          <Surface as="ol" aria-label={t("list.listLabel")} className="mt-10 divide-y divide-ed-line overflow-hidden">
            {interviews.map((interview, i) => (
              <InterviewRow
                key={interview.id}
                interview={interview}
                state={listState(interview, entitlement, now)}
                n={ordinal(i)}
                locale={locale}
                t={t}
                common={common}
              />
            ))}
          </Surface>
        )}
        <HistoryLine hidden={hidden} />
      </div>
    </div>
  );
}
