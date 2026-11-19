import { getLocale, getT } from "@/lib/i18n/server";
import LegalDocument from "./components/LegalDocument";
import type { LegalSection } from "./utils/sections";

const SECTIONS = [
  { heading: "refunds.who.heading", body: ["refunds.who.p1"] },
  { heading: "refunds.subscriptions.heading", body: ["refunds.subscriptions.p1"] },
  { heading: "refunds.packs.heading", body: ["refunds.packs.p1"] },
  { heading: "refunds.problems.heading", body: ["refunds.problems.p1"] },
  { heading: "refunds.contact.heading", body: ["refunds.contact.p1"] },
] as const satisfies readonly LegalSection[];

export default async function RefundsScreen() {
  const [t, locale] = await Promise.all([getT("legal"), getLocale()]);
  return <LegalDocument t={t} locale={locale} page="refunds" sections={SECTIONS} />;
}
