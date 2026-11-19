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
  "flex min-h-11 items-baseline gap-3 py-2.5 text-ed-small text-ed-ink-2 no-underline transition-colors duration-200 hover:text-ed-ink focus-visible:outline-offset-[-2px] motion-reduce:transition-none";

/** A paragraph's words, with the draft's gaps drawn as gaps and the contact address as a link. */
function Words({ text }: { text: string }) {
  return legalParts(text, VALUES).map((part, i) => {
    if (part.kind === "placeholder") {
      return (
        <span
          key={i}
          data-legal-placeholder
          className="rounded-[3px] border border-dashed border-ed-ink-3 px-1 text-ed-ink [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
        >
          {part.text}
        </span>
      );
    }
    if (part.kind === "email") {
      return (
        <a key={i} href={`mailto:${part.text}`} className="text-ed-ink underline decoration-ed-ink-3 underline-offset-4 hover:decoration-ed-ink">
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
    <div className={cn("ed-root flex-1", fontText.variable)}>
      <article aria-labelledby="legal-title" className="ed-wrap pt-[clamp(24px,4vw,48px)] pb-ed-section">
        <p role="note" className="ed-surface max-w-[92ch] border-dashed border-ed-ink-3 px-5 py-4 text-ed-small text-ed-ink sm:px-6">
          {t("draft.banner")}
        </p>

        <header className="ed-grid gap-y-5 border-b border-ed-line-2 pt-[clamp(32px,5vw,64px)] pb-8 lg:items-end lg:pb-10">
          <p className="ed-cap lg:col-span-12">
            <time dateTime={updated}>{t("updated", { date: formatLongDate(updated, locale) })}</time>
          </p>
          <h1 id="legal-title" className="ed-display text-ed-h2 text-balance text-ed-ink lg:col-[1/span_8]">
            {text(`${page}.title`)}
          </h1>
          <p className="max-w-[44ch] text-ed-lede text-ed-ink-2 lg:col-[9/span_4] lg:pb-1.5">{text(`${page}.lede`)}</p>
        </header>

        <div className="ed-grid gap-y-10 pt-[clamp(32px,4.5vw,56px)]">
          <aside className="lg:col-[1/span_3]">
            {/* The rail stays in view under the 64 px header; a long contents list scrolls inside it. */}
            <div className="lg:sticky lg:top-[calc(var(--spacing-ed-header)+32px)] lg:max-h-[calc(100dvh-var(--spacing-ed-header)-48px)] lg:overflow-y-auto lg:[scrollbar-width:thin] lg:[scrollbar-color:var(--color-ed-line-2)_transparent]">
              <nav aria-labelledby={TOC_ID}>
                <p id={TOC_ID} className="ed-cap">
                  {t("nav.toc")}
                </p>
                <ol className="mt-3 border-t border-ed-line">
                  {entries.map(({ anchor, n, heading }) => (
                    <li key={anchor} className="border-b border-ed-line">
                      <a href={`#${anchor}`} className={RAIL_LINK}>
                        <span aria-hidden className="ed-mono w-6 flex-none text-ed-micro text-ed-ink-3">
                          {n}
                        </span>
                        <span className="min-w-0">{heading}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
              {/* On a phone the footer, right under the text, has the same three links. */}
              <nav aria-label={t("nav.label")} className="mt-10 max-lg:hidden">
                <p className="ed-cap">{t("nav.label")}</p>
                <ul className="mt-3 border-t border-ed-line">
                  {PAGES.map((other) => (
                    <li key={other.href} className="border-b border-ed-line">
                      <Link
                        href={other.href}
                        aria-current={other.page === page ? "page" : undefined}
                        className={cn(RAIL_LINK, "aria-[current=page]:text-ed-ink aria-[current=page]:font-medium")}
                      >
                        {t(`${other.page}.title`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </aside>

          <div className="min-w-0 lg:col-[5/span_8]">
            {entries.map(({ section, anchor, n, heading }) => (
              <section
                key={anchor}
                id={anchor}
                aria-labelledby={`${anchor}-title`}
                className="group/section border-t border-ed-line-2 py-[clamp(28px,3.5vw,40px)] first:border-t-0 first:pt-0"
              >
                <h2 id={`${anchor}-title`} className="max-w-[68ch] text-ed-h3 font-semibold text-balance text-ed-ink sm:flex sm:items-baseline sm:gap-4">
                  {/* The heading reads as its words; the number is for the eye, and turns ink when a link lands here. */}
                  <span aria-hidden className="ed-mono mr-3 inline-block text-ed-micro font-normal text-ed-ink-3 transition-colors sm:mr-0 sm:w-6 sm:flex-none duration-200 group-target/section:text-ed-ink motion-reduce:transition-none">
                    {n}
                  </span>
                  <span className="min-w-0">{heading}</span>
                </h2>
                <div className="mt-4 grid max-w-[68ch] gap-4 text-ed-body leading-[1.7] text-ed-ink-2 sm:pl-10">
                  {section.body.map((part, j) =>
                    typeof part === "string" ? (
                      <p key={j}>
                        <Words text={text(part)} />
                      </p>
                    ) : (
                      <ul key={j} className="grid gap-3">
                        {part.map((item) => (
                          <li key={item} className="relative pl-5 before:absolute before:top-[0.8em] before:left-0 before:h-px before:w-2.5 before:bg-ed-ink-3">
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
