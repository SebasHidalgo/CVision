import { getT } from "@/lib/i18n/server";
import TermsScreen from "@/screens/Legal/TermsScreen";

export async function generateMetadata() {
  const t = await getT("legal");
  return { title: t("terms.title") };
}

export default function TermsPage() {
  return <TermsScreen />;
}
