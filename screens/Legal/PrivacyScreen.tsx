import { getT } from "@/lib/i18n/server";
import LegalDocument, { type LegalSection } from "./components/LegalDocument";

const SECTIONS = [
  { heading: "privacy.responsible.heading", body: ["privacy.responsible.p1"] },
  {
    heading: "privacy.collect.heading",
    body: [
      "privacy.collect.p1",
      [
        "privacy.collect.account",
        "privacy.collect.cv",
        "privacy.collect.postings",
        "privacy.collect.interviews",
        "privacy.collect.translations",
        "privacy.collect.usage",
        "privacy.collect.billing",
      ],
    ],
  },
  {
    heading: "privacy.processors.heading",
    body: [
      [
        "privacy.processors.google",
        "privacy.processors.elevenlabs",
        "privacy.processors.clerk",
        "privacy.processors.supabase",
        "privacy.processors.merchant",
        "privacy.processors.vercel",
      ],
      "privacy.processors.p1",
    ],
  },
  { heading: "privacy.retention.heading", body: ["privacy.retention.p1"] },
  { heading: "privacy.rights.heading", body: ["privacy.rights.p1"] },
  { heading: "privacy.cookies.heading", body: ["privacy.cookies.p1"] },
] as const satisfies readonly LegalSection[];

export default async function PrivacyScreen() {
  const t = await getT("legal");
  return <LegalDocument t={t} page="privacy" sections={SECTIONS} />;
}
