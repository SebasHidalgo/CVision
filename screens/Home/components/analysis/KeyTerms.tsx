"use client";

import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";

/** "Node.js ✓ · PostgreSQL ✗ or MySQL ✗": the terms the posting names, as the analysis page lists them. */
export function KeyTerms({ groups }: { groups: LocalizedRequirement["terms"] }) {
  const { t } = useTranslation("landingAnalysis");
  // Spanish writes "u" before a word that sounds like "o", as the app does.
  const or = (next: string) => (/^h?o/i.test(next) ? t("requirements.orBeforeO") : t("requirements.or"));
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
      <span className="cap">{t("requirements.termsLabel")}</span>
      {groups.map((group, gi) => (
        <span key={gi} className="text-[14.5px]">
          {group.map((term, ti) => (
            <Fragment key={term.id}>
              {ti > 0 && <span className="text-ink-3"> {or(term.name)} </span>}
              <span className={term.found ? "text-ink" : "text-ink-3"}>
                {term.name} <span aria-hidden>{term.found ? "✓" : "✗"}</span>
                <span className="sr-only">{term.found ? t("requirements.termShown") : t("requirements.termMissing")}</span>
              </span>
            </Fragment>
          ))}
        </span>
      ))}
    </p>
  );
}
