import { getT } from "@/lib/i18n/server";
import AccountScreen from "@/screens/Account/AccountScreen";

export async function generateMetadata() {
  const t = await getT("account");
  return { title: t("meta.accountTitle") };
}

// Bounds deleteAccountAction: one call to Clerk, then the whole account's cascade (the subscription at the
// provider, each analysis with its CV and voice conversations, the user row). A literal, as Next requires.
export const maxDuration = 60;

export default function AccountPage() {
  return <AccountScreen />;
}
