"use client";

import { useTranslation } from "react-i18next";
import { Surface } from "@/components/design-system/Surface";
import { SCORE_THRESHOLDS, scoreTone, toneKey } from "@/lib/score";
import { QUALITY_SCORE, READING_IDS, READING_SCORES } from "./exampleReport";

/** The five readings that look at the CV on its own, with the quality score beside them. */
export function Readings() {
  const { t } = useTranslation("landingAnalysis");
  const { t: common } = useTranslation("common");
  const word = (score: number) => common(toneKey("tone", scoreTone(score)));
  return (
    <div className="ed-grid mt-[clamp(56px,7vw,96px)] gap-y-7">
      <div className="grid content-start gap-3 text-ed-ink-2 lg:col-[1/span_3]">
        <h3 className="text-ed-h3 font-semibold text-ed-ink">{t("readings.title")}</h3>
        <p>{t("readings.body")}</p>
        <p className="mt-3 grid gap-0.5 border-t border-ed-line pt-3">
          <span className="ed-cap">{t("readings.quality")}</span>
          <span className="ed-mono text-[40px] leading-[1.1] text-ed-ink">{QUALITY_SCORE}</span>
          <span>{word(QUALITY_SCORE)}</span>
        </p>
      </div>
      <Surface as="ol" className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-x-ed-gutter px-5 max-sm:px-4 lg:col-[4/span_9] lg:grid-cols-2">
        {READING_IDS.map((id) => {
          const score = READING_SCORES[id];
          return (
            <li key={id} className="grid content-start gap-2 border-b border-ed-line pt-[18px] pb-[22px] text-[15px] text-ed-ink-2 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-[16.5px] font-semibold text-ed-ink">{t(`readings.items.${id}.name`)}</h4>
                {score === null ? (
                  <span className="text-[13.5px] whitespace-nowrap text-ed-ink-3">{t("readings.noScore")}</span>
                ) : (
                  <span className="text-[14.5px] whitespace-nowrap text-ed-ink">
                    <span className="ed-mono">{score}</span> {word(score)}
                  </span>
                )}
              </div>
              {score !== null && (
                <span aria-hidden className="relative block h-[3px] bg-ed-line-2">
                  <span className="absolute inset-y-0 left-0 bg-ed-ink" style={{ width: `${score}%` }} />
                  <i className="absolute -top-[3px] h-[9px] w-px bg-ed-ink-3" style={{ left: `${SCORE_THRESHOLDS.fair}%` }} />
                  <i className="absolute -top-[3px] h-[9px] w-px bg-ed-ink-3" style={{ left: `${SCORE_THRESHOLDS.strong}%` }} />
                </span>
              )}
              <p>{t(`readings.items.${id}.reads`)}</p>
              <p className="text-[14.5px] text-ed-ink">
                <span className="ed-cap mb-0.5 block">{t("readings.found")}</span>
                {t(`readings.items.${id}.found`)}
              </p>
            </li>
          );
        })}
      </Surface>
    </div>
  );
}
