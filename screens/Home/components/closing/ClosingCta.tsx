"use client";

import { useTranslation } from "react-i18next";
import { PLANS } from "@/lib/plans";
import { StartCta } from "@/screens/Home/components/StartCta";

/** The last call to action, before the footer. */
export function ClosingCta() {
  const { t } = useTranslation("landing");
  return (
    <section aria-labelledby="closing-title" className="pt-ed-section">
      <div className="ed-wrap">
        <div className="ed-surface ed-grid gap-y-6 px-[clamp(20px,4vw,56px)] py-[clamp(36px,6vw,72px)] lg:items-end">
          <h2 id="closing-title" className="ed-display text-ed-h2 text-balance lg:col-span-8">
            {t("closing.title")}
          </h2>
          <div className="grid gap-4 lg:col-span-4">
            <p className="max-w-[40ch] text-ed-lede text-ed-ink-2">{t("closing.body", { count: PLANS.FREE.analysesPerMonth })}</p>
            <div>
              <StartCta label={t("closing.start")} signedInLabel={t("closing.analyze")} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
