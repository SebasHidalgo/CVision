import { INTERVIEW_PACK_CREDITS } from "@/lib/plans";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY_NAME, MERCHANT_OF_RECORD } from "@/lib/legal";
import LegalDocument, { type LegalSection } from "./components/LegalDocument";

const SECTIONS: LegalSection[] = [
  {
    heading: "1. Who refunds",
    body: [
      `Every purchase is made through ${MERCHANT_OF_RECORD}, the merchant of record. Refunds are issued by ${MERCHANT_OF_RECORD} to the payment method you used, under its own buyer terms, and show on your statement from it.`,
    ],
  },
  {
    heading: "2. Subscriptions",
    body: [
      "You can cancel Pro at any time from your account page. Cancelling stops the next charge; Pro stays active until the end of the period you already paid for, and nothing is deleted when it ends. [PLACEHOLDER: whether a refund of the current period is offered, and under what conditions, e.g. within N days of a charge if no interview was run.]",
    ],
  },
  {
    heading: "3. Interview packs",
    body: [
      `A pack adds ${INTERVIEW_PACK_CREDITS} practice interviews. [PLACEHOLDER: whether unused packs are refundable, within what window.] If a pack is refunded, the credits that were not used are removed; interviews already run are not.`,
    ],
  },
  {
    heading: "4. Something went wrong",
    body: [
      "If a paid interview failed on our side (the interviewer never connected, or the call was lost with no reconnection left), the interview is given back to your plan automatically; you do not need to ask. If something else went wrong with a charge, write to us and we will sort it out with the merchant of record.",
    ],
  },
  {
    heading: "5. Contact",
    body: [`${LEGAL_ENTITY_NAME}, ${LEGAL_CONTACT_EMAIL}. [PLACEHOLDER: expected response time.]`],
  },
];

export default function RefundsScreen() {
  return (
    <LegalDocument
      title="Refunds"
      lede="How cancellations and refunds work for Pro and the interview packs. A draft: the owner finalizes it with legal help before launch."
      sections={SECTIONS}
    />
  );
}
