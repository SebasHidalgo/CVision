"use client";

import { useTranslation } from "react-i18next";
import { SectionHeading } from "@/components/design-system/SectionHeading";
import { cn } from "@/lib/utils";
import { StoryCaseContext, useStoryCaseValue } from "./figureContext";
import { Stage } from "./Stage";
import { Still } from "./Still";
import { StoryRail } from "./StoryRail";
import { pad2, STEP_IDS, STORY_ANCHOR } from "./storyData";
import { useActiveStep } from "./useActiveStep";

/**
 * Section 01, how it works: six steps of narration beside one object, the posting's requirements, that changes with
 * them. On a large screen the object is sticky beside the text and moves from step to step; on a phone, and for
 * readers who asked for less motion, each step draws its own still. Needs the `landingStory`, `landing` and `common`
 * namespaces on the client. No props.
 */
export function Story() {
  const { t } = useTranslation("landingStory");
  const storyCase = useStoryCaseValue();
  const { active, go, stepRefs, railRef } = useActiveStep(STEP_IDS.length);

  return (
    <section id={STORY_ANCHOR} aria-labelledby={`${STORY_ANCHOR}-title`} className="pt-ed-section">
      <StoryCaseContext value={storyCase}>
        <div className="ed-wrap">
          <SectionHeading
            n="01"
            id={`${STORY_ANCHOR}-title`}
            title={t("title")}
            lede={
              <p>
                {t("lede")}{" "}
                {/* The index exists only beside the moving object. */}
                <span className="hidden lg:motion-safe:inline">{t("ledeRail")}</span>
              </p>
            }
          />
          <div className="ed-grid items-start">
            <ol className="grid lg:col-[1/span_4] lg:pb-[22vh] lg:motion-reduce:col-[1/-1] lg:motion-reduce:pb-0">
              {STEP_IDS.map((id, i) => {
                const current = active === i;
                return (
                  <li
                    key={id}
                    ref={stepRefs[i]}
                    data-i={i}
                    className="grid scroll-mt-[120px] gap-[22px] border-t border-ed-line py-9 first:border-t-0 first:pt-2 lg:min-h-[72vh] lg:content-center lg:border-t-0 lg:py-10 lg:first:pt-10 lg:motion-reduce:min-h-0 lg:motion-reduce:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:motion-reduce:content-start lg:motion-reduce:gap-x-ed-gutter lg:motion-reduce:border-t"
                  >
                    <div className="grid content-start gap-3">
                      <p aria-hidden className="ed-mono text-[13px] tracking-[0.02em] text-ed-ink-3">
                        <span className={cn("text-ed-ink transition-colors duration-300", !current && "lg:motion-safe:text-ed-ink-3")}>{pad2(i + 1)}</span>
                        {` / ${pad2(STEP_IDS.length)} · `}
                        {t(`steps.${id}.short`)}
                      </p>
                      <h3
                        tabIndex={-1}
                        className={cn(
                          "text-[22px] font-semibold leading-[1.22] tracking-[-0.012em] text-ed-ink transition-colors duration-300",
                          !current && "lg:motion-safe:text-ed-ink-3",
                        )}
                      >
                        {t(`steps.${id}.title`)}
                      </h3>
                      <p className="max-w-[54ch] text-ed-ink-2">{t(`steps.${id}.p1`)}</p>
                      <p className="max-w-[54ch] text-ed-ink-2">{t(`steps.${id}.p2`)}</p>
                    </div>
                    <div className="lg:hidden lg:motion-reduce:block">
                      <Still step={id} />
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="hidden lg:col-[5/span_8] lg:row-start-1 lg:block lg:h-full lg:pl-[clamp(12px,2vw,36px)] lg:motion-reduce:hidden">
              <div className="sticky top-[84px] grid h-[calc(100svh-104px)] max-h-[760px] grid-rows-[auto_1fr] content-start gap-[18px] [@media(max-height:780px)]:top-[76px] [@media(max-height:780px)]:h-[calc(100svh-88px)] [@media(max-height:780px)]:gap-3">
                <StoryRail active={active} onGo={go} railRef={railRef} />
                <Stage step={STEP_IDS[active]} className="self-center" />
              </div>
            </div>
          </div>
        </div>
      </StoryCaseContext>
    </section>
  );
}
