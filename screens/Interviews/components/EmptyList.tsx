import { ButtonLink } from "@/components/design-system/Button";
import { Surface } from "@/components/design-system/Surface";

// A transcript before its first line: literal widths so Tailwind sees them.
const BLANK_LINES = [
  { label: "w-16", text: "w-[78%]" },
  { label: "w-9", text: "w-[54%]" },
  { label: "w-16", text: "w-[66%]" },
  { label: "w-9", text: "w-[38%]" },
];

/** No interviews yet: a blank transcript, a sentence, and the one way to start (from an analysis). */
export function EmptyList({ title, body, action }: { title: string; body: string; action: { href: string; label: string } }) {
  return (
    <Surface as="section" aria-labelledby="empty-interviews-title" className="ed-grid mt-10 gap-y-10 p-6 sm:p-8 lg:items-center lg:p-10">
      <div aria-hidden className="grid content-start gap-4 lg:col-span-5">
        {BLANK_LINES.map((line, i) => (
          <div key={i} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-4">
            <span className={`h-2 rounded-full bg-ed-line-2 ${line.label}`} />
            <span className={`h-2 rounded-full bg-ed-raise ${line.text}`} />
          </div>
        ))}
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <h2 id="empty-interviews-title" className="ed-display text-[clamp(28px,3vw,40px)] leading-[1.08] tracking-[-0.02em] text-balance text-ed-ink">
          {title}
        </h2>
        <p className="mt-4 max-w-[52ch] text-ed-lede text-ed-ink-2">{body}</p>
        <ButtonLink href={action.href} className="mt-8">
          {action.label}
        </ButtonLink>
      </div>
    </Surface>
  );
}
