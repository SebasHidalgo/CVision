"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeading } from "@/components/design-system/SectionHeading";
import { useExampleCase } from "@/screens/Home/hooks/useExampleCase";
import { PROOF_REQUIREMENT } from "./exampleReport";
import { Fixes } from "./Fixes";
import { ProofQuote } from "./ProofQuote";
import { Readings } from "./Readings";
import { RequirementTable } from "./RequirementTable";
import { caseTally, caseVerdict } from "./tally";
import { VerdictCard } from "./VerdictCard";

/**
 * 02: the example's analysis. The verdict is counted from the requirements, as the app counts it; each row opens
 * on its note and key terms; then the readings that look at the CV alone, and the fixes.
 * Needs the `landing`, `landingAnalysis` and `common` namespaces on the client.
 */
export function AnalysisSection() {
  const { t } = useTranslation("landingAnalysis");
  const example = useExampleCase();
  const tally = useMemo(() => caseTally(example.requirements), [example.requirements]);
  const proof = example.requirements.find((r) => r.id === PROOF_REQUIREMENT);
  return (
    <section id="analysis" aria-labelledby="analysis-heading" className="pt-ed-section">
      <div className="ed-wrap">
        <SectionHeading n="02" id="analysis-heading" title={t("title")} lede={<p>{t("lede")}</p>} />
        <div className="ed-grid gap-y-8">
          <VerdictCard tone={caseVerdict(tally)} tally={tally} className="lg:col-[1/span_3]" />
          <RequirementTable requirements={example.requirements} className="lg:col-[4/span_9]" />
        </div>
        {proof && <ProofQuote requirement={proof} candidate={example.candidate} />}
        <Readings />
        <Fixes />
      </div>
    </section>
  );
}
