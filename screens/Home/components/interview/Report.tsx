"use client";

import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { InterviewReport } from "@/components/interview/feedback/InterviewReport";
import { useExampleCase, type LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { formatLongDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { EXAMPLE_REPORT, exampleReportData } from "./exampleReport";
import type { Script } from "./useTalkScript";

/**
 * The app's interview feedback page for the example conversation: the same report tree the page renders
 * (components/interview/feedback), fed with the example in the app's report shape. Static: memoized so the excerpt's
 * clock doesn't re-render it.
 */
export const Report = memo(function Report({
  script,
  role,
  requirements,
  quoteOf,
  locale,
}: {
  script: Script;
  role: string;
  requirements: readonly LocalizedRequirement[];
  /** The candidate's words of a talk line, as the report quotes them. */
  quoteOf: (line: number) => string;
  locale: Locale;
}) {
  const { t } = useTranslation("feedback");
  const { t: common } = useTranslation("common");
  const { t: tl } = useTranslation("landingInterview");
  const { company } = useExampleCase();
  const data = useMemo(
    () => exampleReportData({ role, company, date: formatLongDate(EXAMPLE_REPORT.date, locale), requirements, script, quoteOf, t, tl }),
    [role, company, locale, requirements, script, quoteOf, t, tl],
  );

  return (
    <div className="px-[clamp(14px,2.4vw,28px)] pb-8">
      <InterviewReport
        {...data}
        t={t}
        common={common}
        embedded
        idPrefix="landing-feedback"
        transcriptNote={tl("example.sample", { total: EXAMPLE_REPORT.transcriptLines })}
      />
    </div>
  );
});
