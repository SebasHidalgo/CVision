import { getT } from "@/lib/i18n/server";
import RefundsScreen from "@/screens/Legal/RefundsScreen";

export async function generateMetadata() {
  const t = await getT("legal");
  return { title: t("refunds.title") };
}

export default function RefundsPage() {
  return <RefundsScreen />;
}
