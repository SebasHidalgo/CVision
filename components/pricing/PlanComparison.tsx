import { Surface } from "@/components/design-system/Surface";
import { cn } from "@/lib/utils";
import { PLAN_KEYS, type PlanKey, type PricingPlan, type PricingView } from "./pricingView";

/**
 * Where the reader stands on a plan, by shape: their plan (filled), their plan at risk or ending (half), or a note
 * about a plan that isn't theirs (an outline). The same shapes as the account page's.
 */
export type PlanStanding = {
  tone: "current" | "at-risk" | "note";
  label: string;
  detail: string | null;
};

const MARK: Record<PlanStanding["tone"], string> = {
  current: "bg-ink",
  "at-risk": "bg-[linear-gradient(to_top,var(--color-ink)_50%,transparent_50%)]",
  note: "",
};

export type PlanComparisonProps = {
  view: PricingView;
  /** Each plan's action, already decided by the page: a sign-up, a checkout, the portal, a link or a line. */
  actions: Record<PlanKey, React.ReactNode>;
  /** Nothing for a visitor; the pricing page passes the reader's standing. */
  standing?: Partial<Record<PlanKey, PlanStanding | null>>;
  /** The level of the plan names, in the table and the cards alike: 2 on the pricing page, 3 inside the landing's section. */
  headingLevel?: 2 | 3;
  /** Keeps the plan names' ids unique on the page. */
  idPrefix?: string;
};

// The reader's plan carries a 2 px ink rule on top: a shape, not a colour (never the signal green).
const CURRENT_RULE = "shadow-[inset_0_2px_0_var(--color-ink)]";
const CARD_CURRENT_RULE = "shadow-[inset_0_2px_0_var(--color-ink),var(--shadow-surface)]";
const CELL = "py-4 pr-4 text-left align-top font-normal";

/**
 * Free and Pro compared, for the landing and the pricing page alike: a table from 1024 px, plan cards below it (one
 * column on a phone, two on a tablet). Server-renderable and hook-free; the page decides the actions and the standing.
 */
export function PlanComparison({ view, actions, standing, headingLevel = 3, idPrefix = "plan" }: PlanComparisonProps) {
  const current = PLAN_KEYS.find((key) => standing?.[key] && standing[key].tone !== "note") ?? null;
  const hasStanding = PLAN_KEYS.some((key) => standing?.[key]);
  return (
    <div data-pricing-part="plans">
      <Surface data-pricing-part="table" className="px-6 pt-2 pb-6 max-lg:hidden">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">{view.caption}</caption>
          <colgroup>
            {/* Three of the twelve grid columns (and their gutters) for the labels: the plans get the room their actions need. */}
            <col className="w-[calc((100%_-_11*var(--spacing-gutter))/4_+_3*var(--spacing-gutter))]" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <td className={cn(CELL, "border-b border-line-2 pt-5 pb-5")} />
              {PLAN_KEYS.map((key) => (
                <th
                  key={key}
                  scope="col"
                  data-plan={key}
                  data-current={current === key || undefined}
                  className={cn(CELL, "border-b border-line-2 pt-5 pb-5", current === key && CURRENT_RULE)}
                >
                  {/* HTML keeps h1–h6 out of a <th>: the heading is an ARIA one, so the column header stays a header. */}
                  <PlanName level={headingLevel}>{view.plans[key].name}</PlanName>
                  <PlanPrice plan={view.plans[key]} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasStanding && (
              <tr>
                <th scope="row" className={cn(CELL, "border-b border-line")}>
                  <span className="sr-only">{view.standingLabel}</span>
                </th>
                {PLAN_KEYS.map((key) => (
                  <td key={key} className={cn(CELL, "border-b border-line")}>
                    {standing?.[key] && <Standing standing={standing[key]} />}
                  </td>
                ))}
              </tr>
            )}
            {view.rows.map((row) => (
              <tr key={row.id} data-pricing-part="row" data-row={row.id}>
                <th scope="row" className={cn(CELL, "border-b border-line text-small text-ink-3")}>
                  {row.label}
                </th>
                {PLAN_KEYS.map((key) => (
                  <td key={key} className={cn(CELL, "border-b border-line text-ink-2")}>
                    {row[key]}
                  </td>
                ))}
              </tr>
            ))}
            <tr data-pricing-part="actions">
              <th scope="row" className="pt-6 pr-4 text-left">
                <span className="sr-only">{view.actionsLabel}</span>
              </th>
              {PLAN_KEYS.map((key) => (
                <td key={key} data-plan-action={key} className="pt-6 pr-4 align-top">
                  {actions[key]}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </Surface>

      <div data-pricing-part="cards" className="grid gap-5 sm:grid-cols-2 lg:hidden">
        {PLAN_KEYS.map((key) => {
          const id = `${idPrefix}-${key}-name`;
          const Heading = headingLevel === 2 ? "h2" : "h3";
          return (
            <Surface
              key={key}
              as="section"
              aria-labelledby={id}
              data-plan={key}
              data-current={current === key || undefined}
              className={cn("flex flex-col gap-4 p-5 sm:p-6", current === key && CARD_CURRENT_RULE)}
            >
              <div>
                <PlanName as={Heading} id={id}>
                  {view.plans[key].name}
                </PlanName>
                <PlanPrice plan={view.plans[key]} />
              </div>
              {standing?.[key] && <Standing standing={standing[key]} />}
              <dl>
                {view.rows.map((row) => (
                  <div key={row.id} data-pricing-part="row" data-row={row.id} className="grid gap-0.5 border-b border-line py-3 first:border-t">
                    <dt className="text-small text-ink-3">{row.label}</dt>
                    <dd className="text-ink-2">{row[key]}</dd>
                  </div>
                ))}
              </dl>
              <div data-pricing-part="actions" data-plan-action={key} className="mt-auto pt-2">
                {actions[key]}
              </div>
            </Surface>
          );
        })}
      </div>
    </div>
  );
}

/** A plan's name, set in the display face: an <hN> element, or with `level` a span with the heading role. */
function PlanName({ children, as: Tag = "span", id, level }: { children: string; as?: "span" | "h2" | "h3"; id?: string; level?: 2 | 3 }) {
  return (
    <Tag
      id={id}
      role={level ? "heading" : undefined}
      aria-level={level}
      className="block font-display text-title font-normal text-ink [font-variation-settings:'opsz'_72,'SOFT'_0,'WONK'_0]"
    >
      {children}
    </Tag>
  );
}

/** "$15 a month": the amount in mono, the cadence beside it. */
function PlanPrice({ plan }: { plan: PricingPlan }) {
  return (
    <span className="mt-1.5 block text-ink-2">
      <span className="mono text-[20px] text-ink">{plan.price}</span>
      {plan.cadence && <> {plan.cadence}</>}
    </span>
  );
}

function Standing({ standing }: { standing: PlanStanding }) {
  return (
    <div data-pricing-part="standing" data-tone={standing.tone}>
      <p className="flex items-center gap-2 text-cap font-semibold text-ink uppercase">
        <span aria-hidden className={cn("inline-block size-[9px] flex-none border-[1.5px] border-ink", MARK[standing.tone])} />
        {standing.label}
      </p>
      {standing.detail && <p className="mt-2 max-w-[46ch] text-ink-2">{standing.detail}</p>}
    </div>
  );
}
