import Link from "next/link";
import type { TFunction } from "i18next";
import { fontText } from "@/components/design-system/fonts";
import { formatLongDate, ordinal } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { LEGAL_UPDATED, type LegalPage } from "@/lib/legal";
import { cn } from "@/lib/utils";
import { legalParts, sectionAnchor, type LegalKey, type LegalSection } from "../utils/sections";
import { LEGAL_VALUES as VALUES } from "../utils/values";

type LegalDocumentProps = {
  /** The request's legal namespace: the screen resolves it, this stays synchronous. */
  t: TFunction<"legal">;
  locale: Locale;
  page: LegalPage;
  sections: readonly LegalSection[];
};

const PAGES = [
  { page: "terms", href: "/terms" },
  { page: "privacy", href: "/privacy" },
  { page: "refunds", href: "/refunds" },
] as const;

const TOC_ID = "legal-toc-title";
// The ring sits inside the link: the rail scrolls on short screens, and its edge would clip a ring drawn outside.
const RAIL_LINK =
  "flex min-h-11 items-baseline gap-3 py-2.5 text-small text-ink-2 no-underline transition-colors duration-200 hover:text-ink focus-visible:outline-offset-[-2px] motion-reduce:transition-none";

/** A paragraph's words, with the draft's gaps drawn as gaps and the contact address as a link. */
function Words({ text }: { text: string }) {
  return legalParts(text, VALUES).map((part, i) => {
    if (part.kind === "placeholder") {
      return (
        <span
          key={i}
          data-legal-placeholder
          className="rounded-[3px] border border-dashed border-ink-3 px-1 text-ink [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
        >
          {part.text}
        </span>
      );
    }
    if (part.kind === "email") {
      return (
        <a key={i} href={`mailto:${part.text}`} className="text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
          {part.text}
        </a>
      );
    }
    return part.text;
  });
}

/**
 * One legal page as a long read: the draft banner, the head with its last-updated date, the numbered sections in a
 * column of about 68 characters, and a table of contents (a plain list first on a phone, a rail that stays in view
 * from 1024 px). Anchors come from the section keys, so they are the same in both languages.
 */
export default function LegalDocument({ t, locale, page, sections }: LegalDocumentProps) {
  const text = (key: LegalKey) => t(key, VALUES);
  const updated = LEGAL_UPDATED[page];
  const entries = sections.map((section, i) => ({ section, anchor: sectionAnchor(section), n: ordinal(i), heading: text(section.heading) }));

  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <article aria-labelledby="legal-title" className="wrap pt-[clamp(24px,4vw,48px)] pb-section lg:pb-0">
        <p role="note" className="surface max-w-[92ch] border-dashed border-ink-3 px-5 py-4 text-small text-ink sm:px-6">
          {t("draft.banner")}
        </p>

        <header className="page-grid gap-y-5 border-b border-line-2 pt-[clamp(32px,5vw,64px)] pb-8 lg:items-end lg:pb-10">
          <p className="cap lg:col-span-12">
            <time dateTime={updated}>{t("updated", { date: formatLongDate(updated, locale) })}</time>
          </p>
          <h1 id="legal-title" className="display text-h2 text-balance text-ink lg:col-[1/span_8]">
            {text(`${page}.title`)}
          </h1>
          <p className="max-w-[44ch] text-lede text-ink-2 lg:col-[9/span_4] lg:pb-1.5">{text(`${page}.lede`)}</p>
        </header>

        <div className="page-grid gap-y-10 pt-[clamp(32px,4.5vw,56px)]">
          <aside className="lg:col-[1/span_3]">
            {/* On a phone the footer, right under the text, has the same three links. */}
            <nav aria-label={t("nav.label")} className="mb-10 max-lg:hidden">
              <p className="cap">{t("nav.label")}</p>
              <ul className="mt-3 border-t border-line">
                {PAGES.map((other) => (
                  <li key={other.href} className="border-b border-line">
                    <Link
                      href={other.href}
                      aria-current={other.page === page ? "page" : undefined}
                      className={cn(RAIL_LINK, "aria-[current=page]:text-ink aria-[current=page]:font-medium")}
                    >
                      {t(`${other.page}.title`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {/* Only the contents stick: short enough to stay in its column at the last sections; a long list scrolls. */}
            <div className="lg:sticky lg:top-[calc(var(--spacing-header)+32px)] lg:max-h-[calc(100dvh-var(--spacing-header)-48px)] lg:overflow-y-auto lg:[scrollbar-width:thin] lg:[scrollbar-color:var(--color-line-2)_transparent]">
              <nav aria-labelledby={TOC_ID}>
                <p id={TOC_ID} className="cap">
                  {t("nav.toc")}
                </p>
                <ol className="mt-3 border-t border-line">
                  {entries.map(({ anchor, n, heading }) => (
                    <li key={anchor} className="border-b border-line">
                      <a href={`#${anchor}`} className={RAIL_LINK}>
                        <span aria-hidden className="mono w-6 flex-none text-micro text-ink-3">
                          {n}
                        </span>
                        <span className="min-w-0">{heading}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </div>
          </aside>

          {/* On large screens the page's bottom space lives in the row, so the sticky contents keep their column. */}
          <div className="min-w-0 lg:col-[5/span_8] lg:pb-section">
            {entries.map(({ section, anchor, n, heading }) => (
              <section
                key={anchor}
                id={anchor}
                aria-labelledby={`${anchor}-title`}
                className="group/section border-t border-line-2 py-[clamp(28px,3.5vw,40px)] first:border-t-0 first:pt-0"
              >
                <h2 id={`${anchor}-title`} className="max-w-[68ch] text-h3 font-semibold text-balance text-ink sm:flex sm:items-baseline sm:gap-4">
                  {/* The heading reads as its words; the number is for the eye, and turns ink when a link lands here. */}
                  <span aria-hidden className="mono mr-3 inline-block text-micro font-normal text-ink-3 transition-colors sm:mr-0 sm:w-6 sm:flex-none duration-200 group-target/section:text-ink motion-reduce:transition-none">
                    {n}
                  </span>
                  <span className="min-w-0">{heading}</span>
                </h2>
                <div className="mt-4 grid max-w-[68ch] gap-4 text-body leading-[1.7] text-ink-2 sm:pl-10">
                  {section.body.map((part, j) =>
                    typeof part === "string" ? (
                      <p key={j}>
                        <Words text={text(part)} />
                      </p>
                    ) : (
                      <ul key={j} className="grid gap-3">
                        {part.map((item) => (
                          <li key={item} className="relative pl-5 before:absolute before:top-[0.8em] before:left-0 before:h-px before:w-2.5 before:bg-ink-3">
                            <Words text={text(item)} />
                          </li>
                        ))}
                      </ul>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}
