"use client";

import { useTranslation } from "react-i18next";
import { SectionHeading } from "@/components/design-system/SectionHeading";
import { Surface } from "@/components/design-system/Surface";
import { FaqItem } from "./FaqItem";
import { FAQ_IDS } from "./faqItems";

/** 05: the questions a job seeker asks before signing up. Needs `landingFaq` on the client. */
export function FaqSection() {
  const { t } = useTranslation("landingFaq");
  return (
    <section id="faq" aria-labelledby="faq-heading" className="pt-section">
      <div className="wrap">
        <SectionHeading n="05" id="faq-heading" title={t("title")} />
        <Surface className="px-6 max-sm:px-4">
          {FAQ_IDS.map((id, i) => (
            <FaqItem key={id} index={i} question={t(`items.${id}.q`)} answer={t(`items.${id}.a`)} />
          ))}
        </Surface>
      </div>
    </section>
  );
}
