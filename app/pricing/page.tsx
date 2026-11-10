import { getT } from "@/lib/i18n/server";
import PricingScreen from "@/screens/Pricing/PricingScreen";

export async function generateMetadata() {
  const t = await getT("pricing");
  return { title: t("meta.title") };
}

// Public. For a signed-in visitor it reads the plan (one usage summary); the
// checkout itself runs through createCheckoutAction, one provider call.
export const maxDuration = 30;

export default function PricingPage() {
  return <PricingScreen />;
}
