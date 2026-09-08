import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import { ordinal } from "@/lib/format";

// The six sections every analysis actually produces. Nothing invented.
const DIMENSIONS = [
  {
    name: "ATS compatibility",
    body: "Whether an applicant tracking system can parse it at all: section headers, dates, structure.",
  },
  {
    name: "Experience & impact",
    body: "Do your bullets show outcomes and scope, or only duties? Suggested rewrites included.",
  },
  {
    name: "Skills",
    body: "Which required skills you prove with evidence, which you only name, and which are missing.",
  },
  {
    name: "Education & certifications",
    body: "What counts for this role and what would be worth adding.",
  },
  {
    name: "Tone & clarity",
    body: "Readability, tense, jargon, and how fast a recruiter gets the point.",
  },
  {
    name: "Job fit",
    body: "Keyword and requirement overlap with this specific posting, plus the strategic moves.",
  },
];

export function DimensionsSection() {
  return (
    <section className="border-t border-line">
      <div className="wrap grid gap-12 py-20 lg:grid-cols-12 lg:gap-10 lg:py-28">
        <Reveal className="lg:col-span-4">
          <Eyebrow tick>What gets measured</Eyebrow>
          <h2 className="display-lg mt-5 text-ink">
            Six readings, one verdict.
          </h2>
          <p className="lede mt-5 max-w-sm">
            Each dimension gets its own score, its evidence, and the concrete
            changes that would raise it. The global fit score is the headline;
            these are the reasons.
          </p>
        </Reveal>

        <ol className="lg:col-span-8">
          {DIMENSIONS.map((dimension, i) => (
            <Reveal key={dimension.name} delay={i * 0.06}>
              <li className="group grid gap-3 border-t border-line py-6 last:border-b sm:grid-cols-[3.5rem_1fr_1.4fr] sm:items-baseline sm:gap-6">
                <span className="eyebrow text-ink transition-colors duration-300 group-hover:text-signal">
                  {ordinal(i)}
                </span>
                <h3 className="display-sm text-ink">{dimension.name}</h3>
                <p className="leading-relaxed text-ink-2">{dimension.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
