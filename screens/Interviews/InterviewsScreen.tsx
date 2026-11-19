import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { Surface } from "@/components/design-system/Surface";
import { fetchInterviews } from "@/lib/database/interview";
import { currentInterviewEntitlement } from "@/lib/database/usage";
import { ordinal } from "@/lib/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { EmptyList } from "./components/EmptyList";
import { InterviewRow } from "./components/InterviewRow";
import { PlanLine } from "./components/PlanLine";
import { listState } from "./utils/listState";
import { planLine } from "./utils/planLine";

const HEADING_ID = "interviews-title";

export default async function InterviewsScreen() {
  // Every interview that started, on every plan. The list's read sweeps abandoned interviews first, so the entitlement
  // after it counts their refunds. The page renders on the server: its only client part (a row's delete) gets its words
  // as props, so no namespace travels to the browser beyond the layout's.
  const [interviews, t, common, locale] = await Promise.all([fetchInterviews(), getT("interview"), getT("common"), getLocale()]);
  // What the plan has left: the line under the heading, and whether a waiting interview can start.
  const entitlement = await currentInterviewEntitlement();
  const now = new Date();
  const completed = interviews.filter((interview) => interview.status === "COMPLETED").length;

  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div className="wrap pt-[clamp(40px,6vw,88px)] pb-section">
        <PageHeading
          id={HEADING_ID}
          ruled
          title={t("list.title")}
          aside={
            interviews.length > 0 && (
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <div className="flex items-baseline gap-2.5">
                  <dt className="text-small text-ink-2">{t("list.count")}</dt>
                  <dd className="mono text-[17px] text-ink">{interviews.length}</dd>
                </div>
                <div className="flex items-baseline gap-2.5">
                  <dt className="text-small text-ink-2">{t("list.completed")}</dt>
                  <dd className="mono text-[17px] text-ink">{completed}</dd>
                </div>
              </dl>
            )
          }
        />
        <PlanLine line={planLine(entitlement)} t={t} common={common} locale={locale} />

        {interviews.length === 0 ? (
          <EmptyList title={t("list.emptyTitle")} body={t("list.emptyBody")} action={{ href: "/resume/analyses", label: t("list.emptyAction") }} />
        ) : (
          <Surface as="ol" aria-label={t("list.listLabel")} className="mt-10 divide-y divide-line overflow-hidden">
            {interviews.map((interview, i) => (
              <InterviewRow
                key={interview.id}
                interview={interview}
                state={listState(interview, entitlement, now)}
                n={ordinal(i)}
                locale={locale}
                t={t}
                common={common}
                headingId={HEADING_ID}
              />
            ))}
          </Surface>
        )}
      </div>
    </div>
  );
}
