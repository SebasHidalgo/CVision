import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY_NAME, MERCHANT_OF_RECORD } from "@/lib/legal";
import LegalDocument, { type LegalSection } from "./components/LegalDocument";

const SECTIONS: LegalSection[] = [
  {
    heading: "1. Who is responsible",
    body: [`${LEGAL_ENTITY_NAME} operates CVision and is responsible for the personal data described here. Contact: ${LEGAL_CONTACT_EMAIL}. [PLACEHOLDER: registered address.]`],
  },
  {
    heading: "2. What we collect, and why",
    body: [
      "Everything below exists to give you your own feedback. Nothing is sold, and nothing is used to evaluate you for anyone else.",
      [
        "Your account: an identifier and your sign-in details, held by our authentication provider (Clerk). We store the identifier, not your email or name.",
        "Your CV: the PDF you upload, kept in private storage so you can reopen it next to its analysis, and its text, which is sent to the AI model that writes the analysis.",
        "The job postings you paste: stored with each analysis and sent to the AI model with your CV's text.",
        "Your practice interviews: the conversation runs with the AI voice provider (ElevenLabs), which processes your voice and returns a transcript. The transcript is stored with the interview and sent to the AI model that writes the feedback. [PLACEHOLDER: whether audio recordings are retained by the voice provider and for how long.]",
        "Usage: how many analyses and interviews you ran, for your plan's limits.",
        "Billing: if you buy a plan, the payment is handled by the merchant of record (Paddle), which collects your email, country and payment details. We store only its identifiers for your customer and subscription, never a card or an email.",
      ],
    ],
  },
  {
    heading: "3. Who processes it",
    body: [
      [
        "Google (Gemini) writes the CV analysis and the interview feedback from the text we send.",
        "ElevenLabs runs the voice interview and produces the transcript.",
        "Clerk signs you in.",
        "Supabase hosts the database and the private file storage.",
        `${MERCHANT_OF_RECORD} is the merchant of record for payments.`,
        "Vercel hosts the application.",
      ],
      "[PLACEHOLDER: processing locations, transfer mechanisms, and links to each processor's terms.]",
    ],
  },
  {
    heading: "4. How long we keep it",
    body: [
      "A CV lives as long as its analysis. Deleting an analysis deletes the CV, the analysis, its interviews and their feedback, and asks the voice provider to delete the conversations. Deleting your account deletes everything above and cancels any subscription. The merchant of record keeps the records it must keep for tax purposes. [PLACEHOLDER: backup retention windows.]",
    ],
  },
  {
    heading: "5. Your rights",
    body: [
      "You can see and delete your data from the product itself. For anything else (access, correction, portability, objection, a complaint), write to the contact above. [PLACEHOLDER: the rights that apply under the laws of the entity's jurisdiction and of the people it serves, and response times.]",
    ],
  },
  {
    heading: "6. Cookies",
    body: ["[PLACEHOLDER: the cookies set by the authentication provider, the theme preference, and anything the merchant of record's checkout sets.]"],
  },
];

export default function PrivacyScreen() {
  return (
    <LegalDocument
      title="Privacy"
      lede="What CVision keeps about you, who processes it and why. A draft: the owner finalizes it with legal help before launch."
      sections={SECTIONS}
    />
  );
}
