import Link from "next/link";
import type { ParseKeys, TFunction } from "i18next";
import Eyebrow from "@/components/layout/Eyebrow";
import { LEGAL_CONTACT_EMAIL, LEGAL_DRAFT_DATE, LEGAL_ENTITY_NAME, MERCHANT_OF_RECORD } from "@/lib/legal";
import { INTERVIEW_PACK_CREDITS, INTERVIEW_TIERS, PLANS } from "@/lib/plans";

type LegalKey = ParseKeys<"legal">;

export type LegalPage = "terms" | "privacy" | "refunds";

export type LegalSection = {
  heading: LegalKey;
  /** Paragraphs, or a bulleted list when given an array. */
  body: readonly (LegalKey | readonly LegalKey[])[];
};

type LegalDocumentProps = {
  /** The request's legal namespace: the screen resolves it, this stays synchronous. */
  t: TFunction<"legal">;
  page: LegalPage;
  sections: readonly LegalSection[];
};

const OTHER_PAGES = [
  { href: "/terms", titleKey: "terms.title" },
  { href: "/privacy", titleKey: "privacy.title" },
  { href: "/refunds", titleKey: "refunds.title" },
] as const;

/** Every figure and placeholder the drafts print, from the constants the product enforces. */
const VALUES = {
  entity: LEGAL_ENTITY_NAME,
  email: LEGAL_CONTACT_EMAIL,
  merchant: MERCHANT_OF_RECORD,
  freeAnalyses: PLANS.FREE.analysesPerMonth,
  freeHistory: PLANS.FREE.historyLimit,
  proInterviews: PLANS.PRO.interviewsPerMonth,
  packCredits: INTERVIEW_PACK_CREDITS,
  trialMinutes: INTERVIEW_TIERS.TRIAL.seconds / 60,
  fullMinutes: INTERVIEW_TIERS.FULL.seconds / 60,
};

/** One legal page: a visible draft banner, the sections, and the links to the other two. */
export default function LegalDocument({ t, page, sections }: LegalDocumentProps) {
  const text = (key: LegalKey) => t(key, VALUES);
  return (
    <article className="wrap py-10 lg:py-14">
      <p
        role="note"
        className="border border-signal bg-signal-soft px-4 py-3 font-mono text-xs leading-relaxed text-ink"
      >
        {t("draft.banner")}
      </p>

      <header className="mt-10 border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>{t("draft.eyebrow", { date: LEGAL_DRAFT_DATE })}</Eyebrow>
        <h1 className="display-lg mt-6 text-ink">{text(`${page}.title` as const)}</h1>
        <p className="lede mt-4 max-w-2xl">{text(`${page}.lede` as const)}</p>
      </header>

      <div className="grid gap-12 py-12 lg:grid-cols-12 lg:py-16">
        <div className="space-y-10 lg:col-span-8">
          {sections.map((section, i) => (
            <section key={section.heading} aria-labelledby={`legal-${i}`}>
              <h2 id={`legal-${i}`} className="display-sm text-ink">
                {text(section.heading)}
              </h2>
              <div className="mt-4 space-y-3 leading-relaxed text-ink-2">
                {section.body.map((part, j) =>
                  typeof part === "string" ? (
                    <p key={j}>{text(part)}</p>
                  ) : (
                    <ul key={j} className="list-disc space-y-1.5 pl-5">
                      {part.map((item) => (
                        <li key={item}>{text(item)}</li>
                      ))}
                    </ul>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
        <nav aria-label={t("nav.label")} className="lg:col-span-3 lg:col-start-10">
          <p className="eyebrow">{t("nav.also")}</p>
          <ul className="mt-3 space-y-2 text-sm">
            {OTHER_PAGES.map((other) => (
              <li key={other.href}>
                <Link href={other.href} className="link-rule text-ink-2">
                  {t(other.titleKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </article>
  );
}
