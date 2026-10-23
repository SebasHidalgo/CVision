import PricingScreen from "@/screens/Pricing/PricingScreen";

export const metadata = { title: "Pricing" };

// Public. For a signed-in visitor it reads the plan (one usage summary); the
// checkout itself runs through createCheckoutAction, one provider call.
export const maxDuration = 30;

export default function PricingPage() {
  return <PricingScreen />;
}
