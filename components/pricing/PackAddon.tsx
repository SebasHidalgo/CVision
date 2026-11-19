import { Surface } from "@/components/design-system/Surface";
import type { PricingView } from "./pricingView";

type PackAddonProps = {
  pack: PricingView["pack"];
  /** The credits the reader holds, as a sentence; nothing for a visitor or an empty balance. */
  held?: string | null;
  /** The pack's checkout, when the reader can buy one (Pro in force). */
  action?: React.ReactNode;
  headingLevel?: 2 | 3;
  id?: string;
};

/** The interview pack under the plans: bought with Pro in force, usable on any plan, never expiring. Hook-free. */
export function PackAddon({ pack, held, action, headingLevel = 3, id = "pricing-pack" }: PackAddonProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <Surface as="section" aria-labelledby={id} data-pricing-part="pack" className="ed-grid mt-6 gap-y-2 px-6 py-5 max-sm:px-5">
      <Heading id={id} className="text-ed-cap font-semibold text-ed-ink-3 uppercase lg:col-[1/span_3] lg:pt-1">
        {pack.label}
      </Heading>
      <div className="max-w-[68ch] lg:col-[4/span_9]">
        <p className="text-ed-ink-2">
          <strong className="font-semibold text-ed-ink">{pack.lead}</strong> {pack.body}
        </p>
        {held && (
          <p data-pricing-part="held" className="mt-2 text-ed-ink">
            {held}
          </p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </Surface>
  );
}
