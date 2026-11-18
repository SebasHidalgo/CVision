import { getT } from "@/lib/i18n/server";
import NotFoundScreen from "@/screens/NotFound/NotFoundScreen";

export async function generateMetadata() {
  const t = await getT("notFound");
  return { title: t("meta") };
}

// The root boundary: unknown URLs, and notFound() from any page (no segment below has its own).
export default function NotFound() {
  return <NotFoundScreen />;
}
