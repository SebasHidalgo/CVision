import { parseActivation } from "@/lib/billing/activation";
import { getT } from "@/lib/i18n/server";
import AccountBillingScreen from "@/screens/AccountBilling/AccountBillingScreen";

export async function generateMetadata() {
  const t = await getT("account");
  return { title: t("meta.title") };
}

// One usage summary (with, at most, one lazy reconcile call to the provider),
// one customer read and one transaction check; the checkout and portal
// actions each make one provider call. A literal, as Next requires.
export const maxDuration = 30;

type AccountBillingSearch = Promise<{ activating?: string | string[]; txn?: string | string[] }>;

export default async function AccountBillingPage({ searchParams }: { searchParams: AccountBillingSearch }) {
  // A malformed or partial query (no transaction, an unknown item) is simply no activation.
  const activation = parseActivation(await searchParams);
  return <AccountBillingScreen activation={activation} />;
}
