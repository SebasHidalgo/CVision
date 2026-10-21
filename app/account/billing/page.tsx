import AccountBillingScreen from "@/screens/AccountBilling/AccountBillingScreen";

export const metadata = { title: "Plan & billing" };

// One usage summary (with, at most, one lazy reconcile call to the provider)
// and one customer read; the checkout and portal actions each make one
// provider call. A literal, as Next requires.
export const maxDuration = 30;

type AccountBillingSearch = Promise<{ activating?: string | string[] }>;

export default async function AccountBillingPage({ searchParams }: { searchParams: AccountBillingSearch }) {
  const { activating } = await searchParams;
  const item = activating === "pro_monthly" || activating === "interview_pack" ? activating : null;

  return <AccountBillingScreen activating={item} />;
}
