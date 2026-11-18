import { ButtonLink } from "@/components/design-system/Button";
import { StatusMark } from "@/components/design-system/StatusMark";
import { Surface } from "@/components/design-system/Surface";

// Literal widths so Tailwind sees them.
const BLANK_ROWS = [
  { n: "01", width: "w-[72%]" },
  { n: "02", width: "w-[56%]" },
  { n: "03", width: "w-[64%]" },
];

/** The ledger before its first entry: three blank ruled rows, a sentence, one way forward. */
export function EmptyRecord({ title, body, action }: { title: string; body: string; action: { href: string; label: string } }) {
  return (
    <Surface as="section" aria-labelledby="empty-record-title" className="ed-grid mt-10 gap-y-10 p-6 sm:p-8 lg:items-center lg:p-10">
      <div aria-hidden className="grid content-start lg:col-span-5">
        {BLANK_ROWS.map(({ n, width }) => (
          <div key={n} className="grid grid-cols-[32px_14px_minmax(0,1fr)] items-center gap-3 border-b border-ed-line py-4 first:border-t">
            <span className="ed-mono text-[13px] text-ed-ink-3">{n}</span>
            <StatusMark status="notshown" />
            <span className={`h-2 rounded-full bg-ed-raise ${width}`} />
          </div>
        ))}
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <h2 id="empty-record-title" className="ed-display text-[clamp(28px,3vw,40px)] leading-[1.08] tracking-[-0.02em] text-balance text-ed-ink">
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
