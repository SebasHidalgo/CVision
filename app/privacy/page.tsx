import { getT } from "@/lib/i18n/server";
import PrivacyScreen from "@/screens/Legal/PrivacyScreen";

export async function generateMetadata() {
  const t = await getT("legal");
  return { title: t("privacy.title") };
}

export default function PrivacyPage() {
  return <PrivacyScreen />;
}
