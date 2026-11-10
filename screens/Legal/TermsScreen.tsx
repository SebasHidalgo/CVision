import { getT } from "@/lib/i18n/server";
import LegalDocument, { type LegalSection } from "./components/LegalDocument";

const SECTIONS = [
  { heading: "terms.what.heading", body: ["terms.what.p1", "terms.what.p2"] },
  { heading: "terms.account.heading", body: ["terms.account.p1"] },
  { heading: "terms.plans.heading", body: ["terms.plans.p1", "terms.plans.p2", "terms.plans.p3"] },
  { heading: "terms.fairUse.heading", body: ["terms.fairUse.p1"] },
  { heading: "terms.ai.heading", body: ["terms.ai.p1"] },
  { heading: "terms.content.heading", body: ["terms.content.p1"] },
  { heading: "terms.ending.heading", body: ["terms.ending.p1"] },
  { heading: "terms.liability.heading", body: ["terms.liability.p1"] },
  { heading: "terms.contact.heading", body: ["terms.contact.p1"] },
] as const satisfies readonly LegalSection[];

export default async function TermsScreen() {
  const t = await getT("legal");
  return <LegalDocument t={t} page="terms" sections={SECTIONS} />;
}
