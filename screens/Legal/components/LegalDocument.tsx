import Link from "next/link";
import Eyebrow from "@/components/layout/Eyebrow";
import { LEGAL_DRAFT_BANNER, LEGAL_DRAFT_DATE } from "@/lib/legal";

export type LegalSection = {
  heading: string;
  /** Paragraphs, or a bulleted list when given an array. */
  body: (string | string[])[];
};

type LegalDocumentProps = {
  title: string;
  lede: string;
  sections: LegalSection[];
};

const OTHER_PAGES = [
  { href: "/terms", label: "Terms of service" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
];

/** One legal page: a visible draft banner, the sections, and the links to the other two. */
export default function LegalDocument({ title, lede, sections }: LegalDocumentProps) {
  return (
    <article className="wrap py-10 lg:py-14">
      <p
        role="note"
        className="border border-signal bg-signal-soft px-4 py-3 font-mono text-xs leading-relaxed text-ink"
      >
        {LEGAL_DRAFT_BANNER}
      </p>

      <header className="mt-10 border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>Draft · {LEGAL_DRAFT_DATE}</Eyebrow>
        <h1 className="display-lg mt-6 text-ink">{title}</h1>
        <p className="lede mt-4 max-w-2xl">{lede}</p>
      </header>

      <div className="grid gap-12 py-12 lg:grid-cols-12 lg:py-16">
        <div className="space-y-10 lg:col-span-8">
          {sections.map((section, i) => (
            <section key={section.heading} aria-labelledby={`legal-${i}`}>
              <h2 id={`legal-${i}`} className="display-sm text-ink">
                {section.heading}
              </h2>
              <div className="mt-4 space-y-3 leading-relaxed text-ink-2">
                {section.body.map((part, j) =>
                  Array.isArray(part) ? (
                    <ul key={j} className="list-disc space-y-1.5 pl-5">
                      {part.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={j}>{part}</p>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
        <nav aria-label="Legal pages" className="lg:col-span-3 lg:col-start-10">
          <p className="eyebrow">Also</p>
          <ul className="mt-3 space-y-2 text-sm">
            {OTHER_PAGES.map((page) => (
              <li key={page.href}>
                <Link href={page.href} className="link-rule text-ink-2">
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </article>
  );
}
