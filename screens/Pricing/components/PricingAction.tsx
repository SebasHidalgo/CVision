import type { TFunction } from "i18next";
import CheckoutButton from "@/components/billing/CheckoutButton";
import ManageSubscriptionButton from "@/components/billing/ManageSubscriptionButton";
import { ButtonLink } from "@/components/design-system/Button";
import { SignUpButton } from "@/components/pricing/SignUpButton";
import type { PlanActionSpec } from "../utils/planState";

/** A long label wraps inside its table cell instead of overflowing it; on a phone the pill takes the card's width. */
export const ACTION_WRAP = "h-auto max-w-full whitespace-normal py-2.5 text-center max-sm:w-full";

type PricingActionProps = {
  spec: PlanActionSpec;
  /** Pro's price, formatted from the catalog. */
  proPrice: string;
  t: TFunction<"pricing">;
  common: TFunction<"common">;
};

/** A plan's action on the pricing page, as the state mapper decided it. Server component. */
export function PricingAction({ spec, proPrice, t, common }: PricingActionProps) {
  switch (spec.kind) {
    case "sign-up":
      return spec.redirect === "/pricing" ? (
        <SignUpButton label={t("pro.signUp")} redirect="/pricing" className={ACTION_WRAP} />
      ) : (
        <SignUpButton label={t("free.start")} redirect="/resume/upload" variant="ghost" className={ACTION_WRAP} />
      );
    case "checkout-pro":
      return <CheckoutButton item="pro_monthly" label={t("pro.checkout", { price: proPrice })} size="default" className={ACTION_WRAP} />;
    case "portal":
      // "Manage subscription" is the button's own words; the other two say why the portal is the way.
      return <ManageSubscriptionButton label={spec.label === "manage" ? undefined : t(`actions.portal.${spec.label}`)} className={ACTION_WRAP} />;
    case "link":
      return spec.to === "upload" ? (
        <ButtonLink href="/resume/upload" variant="ghost" className={ACTION_WRAP}>
          {common("nav.newAnalysis")}
        </ButtonLink>
      ) : (
        <ButtonLink href="/account/billing" variant="ghost" className={ACTION_WRAP}>
          {common("nav.planBilling")}
        </ButtonLink>
      );
    case "included":
      return <p className="flex min-h-12 items-center text-ed-ink-2">{t("free.includedInPro")}</p>;
    case "none":
      return null;
  }
}
