"use client";

import { useTranslation } from "react-i18next";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";

/** One CV line set large: the kind of line that proves a requirement. */
export function ProofQuote({ requirement, candidate }: { requirement: LocalizedRequirement; candidate: string }) {
  const { t } = useTranslation("landingAnalysis");
  if (!requirement.evidence || !requirement.line) return null;
  return (
    <figure className="ed-grid mt-[clamp(56px,7vw,96px)] gap-y-4">
      {/* Not a <p>: the page root sets text-wrap: pretty on paragraphs, and this line is balanced. */}
      <blockquote className="ed-display text-[clamp(28px,3.4vw,48px)] leading-[1.12] tracking-[-0.02em] text-balance italic lg:col-[2/span_8]">
        {t("requirements.quote", { text: requirement.evidence })}
      </blockquote>
      <figcaption className="grid content-start gap-1.5 border-t border-ed-line pt-3 text-[15px] text-ed-ink-2 lg:col-[10/span_3]">
        <span className="ed-cap">
          {t("proof.source", { candidate, line: String(requirement.line).padStart(2, "0") })}
        </span>
        <span>{t("proof.note", { n: requirement.n, label: requirement.label })}</span>
      </figcaption>
    </figure>
  );
}
