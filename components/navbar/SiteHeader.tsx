import { currentShellPlan } from "@/lib/database/usage";
import type { HeaderVariant } from "./nav";
import { SiteHeaderClient } from "./SiteHeaderClient";

/**
 * The one header, on every page (SiteHeaderClient), with what only the server knows: the plan is derived there,
 * and the account menu offers Pricing to everyone but Pro. Signed out, or when the plan cannot be read, it does.
 */
export async function SiteHeader({ variant = "app" }: { variant?: HeaderVariant }) {
  const plan = await currentShellPlan();
  return <SiteHeaderClient variant={variant} offerPricing={plan !== "PRO"} />;
}
