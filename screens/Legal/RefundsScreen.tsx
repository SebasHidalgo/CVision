import { getT } from "@/lib/i18n/server";
import LegalDocument, { type LegalSection } from "./components/LegalDocument";

const SECTIONS = [
  { heading: "refunds.who.heading", body: ["refunds.who.p1"] },
  { heading: "refunds.subscriptions.heading", body: ["refunds.subscriptions.p1"] },
  { heading: "refunds.packs.heading", body: ["refunds.packs.p1"] },
  { heading: "refunds.problems.heading", body: ["refunds.problems.p1"] },
  { heading: "refunds.contact.heading", body: ["refunds.contact.p1"] },
] as const satisfies readonly LegalSection[];

export default async function RefundsScreen() {
  const t = await getT("legal");
  return <LegalDocument t={t} page="refunds" sections={SECTIONS} />;
}
