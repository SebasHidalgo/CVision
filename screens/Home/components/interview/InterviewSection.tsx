"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeading } from "@/components/design-system/SectionHeading";
import { useReducedMotion } from "@/hooks/useMediaQuery";
import { useLocale } from "@/hooks/useLocale";
import type { Locale } from "@/lib/i18n/config";
import { Facts } from "./Facts";
import { Screens } from "./Screens";
import { timelineFor } from "./talk";
import { TalkControls } from "./TalkControls";
import { useTalk } from "./useTalk";
import { useTalkScript } from "./useTalkScript";

/**
 * "03 · Interview": the voice interview shown on the app's real screens, playing a short example conversation. The
 * voices are optional: muted by default, downloaded only when the sound is turned on; the words are always on screen.
 */
export function InterviewSection({ n = "03" }: { n?: string }) {
  const { t } = useTranslation("landingInterview");
  const locale = useLocale();
  return (
    <section id="interview" aria-labelledby="interview-title" className="pt-section">
      <div className="wrap">
        <SectionHeading n={n} id="interview-title" title={t("title")} lede={<p>{t("lede")}</p>} />
        {/* A language switch starts the excerpt over: other words, other audio, other timing. */}
        <Excerpt key={locale} locale={locale} />
        <Facts locale={locale} />
      </div>
    </section>
  );
}

function Excerpt({ locale }: { locale: Locale }) {
  const { t } = useTranslation("landingInterview");
  const reduce = useReducedMotion();
  const script = useTalkScript(locale);
  const stage = useRef<HTMLDivElement>(null);
  const talk = useTalk(stage, { timeline: timelineFor(locale), locale, reduce });

  return (
    <div ref={stage} className="grid gap-[22px]">
      <div className="page-grid items-end gap-y-5">
        <p className="max-w-[52ch] text-[17px] text-ink-2 lg:col-span-6">{t("intro")}</p>
        <TalkControls talk={talk} className="lg:col-start-8 lg:col-end-13 lg:justify-self-end" />
      </div>
      <Screens talk={talk} script={script} reduce={reduce} locale={locale} />
    </div>
  );
}
