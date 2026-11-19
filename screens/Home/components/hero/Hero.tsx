"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/components/design-system/Button";
import { StartCta } from "@/screens/Home/components/StartCta";
import { markReady } from "@/screens/Home/utils/readiness";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { HeroFigure } from "./HeroFigure";
import { useFigureMode } from "./useFigureMode";
import { useHeroSequence } from "./useHeroSequence";

// The headline's rise and the rail's fade wait while the loader is up (`data-loading` on <html>), then play; without
// the loader (no JavaScript, a client-side visit) they play at once.
const HOLD = "in-data-loading:[animation-play-state:paused] motion-reduce:animate-none";
const RISE = `inline-block animate-rise min-[700px]:whitespace-nowrap ${HOLD}`;
const FADE = `animate-fade ${HOLD}`;
// Phones: a smaller pill, so both actions share one row at 375 px.
const CTA = "max-lg:px-4 max-lg:text-[15px]";

function HeadlineLine({ ink, children }: { ink?: boolean; children: React.ReactNode }) {
  return (
    // Sized against the headline's own width as well, so the longest line never overflows its eight columns.
    <span
      className={cn(
        "-mb-[0.06em] block overflow-clip pb-[0.06em] text-[min(var(--hero-fs),13cqi)] leading-[0.96] tracking-[-0.035em] [&:lang(es)]:text-[min(var(--hero-fs),15.4cqi)]",
        ink ? "text-ink" : "text-ink-2",
      )}
    >
      <span className={cn(RISE, ink && "[animation-delay:90ms]")}>{children}</span>
    </span>
  );
}

/**
 * The landing's first screen: the headline, the lede, the start actions and the free plan, over the figure that
 * reads the example posting against the example CV. Fits the first screen under the 64 px header at every common
 * size. `id`: an anchor for the section, if the page wants one (the header's home link targets the page root).
 */
export function Hero({ id }: { id?: string }) {
  const { t } = useTranslation("landingHero");
  const titleId = useId();
  const section = useRef<HTMLElement>(null);
  const { started, run, replay, reduce } = useHeroSequence();
  const [sceneFailed, setSceneFailed] = useState(false);
  const mode = useFigureMode(sceneFailed);
  const wide = mode === "scene" || mode === "flat";
  const failScene = useCallback(() => setSceneFailed(true), []);

  // The hero's data is local (the example case and its strings): ready once mounted. No image here is critical
  // today; any added later is decoded before the loader is told.
  useEffect(() => {
    markReady("hero-data");
    const images = Array.from(section.current?.querySelectorAll("img") ?? []);
    Promise.all(images.map((img) => img.decode().catch(() => undefined))).then(() => markReady("images"));
  }, []);

  return (
    <section
      ref={section}
      id={id}
      aria-labelledby={titleId}
      data-hero-section
      data-hero={wide ? "" : undefined}
      className="pt-[clamp(10px,2svh,24px)] [--hero-fs:clamp(38px,min(11.4vw,6.2svh),76px)] lg:h-[calc(100svh-var(--spacing-header))] lg:max-h-[calc(1.92*var(--hero-fs)+min(100vw,1312px)*0.38+300px)] lg:min-h-[520px] lg:pt-[clamp(10px,2.4svh,34px)] lg:pb-[clamp(10px,2svh,22px)] lg:[--hero-fs:clamp(48px,min(7.6vw,10.2svh),112px)]"
    >
      <div className="wrap lg:flex lg:h-full lg:flex-col">
        <div className="page-grid items-end gap-y-3 lg:flex-none lg:gap-y-[clamp(8px,1.6svh,18px)]">
          <h1 id={titleId} data-face="display" className="display @container pt-1 lg:col-[1/span_8] lg:pt-[clamp(2px,1svh,16px)]">
            <HeadlineLine>{t("title.asks")}</HeadlineLine>
            <HeadlineLine ink>{t("title.proves")}</HeadlineLine>
          </h1>
          <div className="grid gap-3 pb-1 lg:col-[9/span_4] lg:gap-[clamp(10px,1.8svh,18px)]">
            <p className={cn("max-w-[46ch] text-[16px] leading-[1.5] text-ink-2 lg:text-[clamp(15.5px,min(1.2vw,2.2svh),17.5px)] lg:leading-[1.55]", FADE, "[animation-delay:250ms]")}>
              {t("lede")}
            </p>
            <div className={cn("flex flex-wrap gap-2.5", FADE, "[animation-delay:320ms]")}>
              <StartCta label={t("start")} signedInLabel={t("startSignedIn")} className={CTA} />
              <a href="#analysis" className={buttonClass({ variant: "ghost", className: CTA })}>
                {t("example")}
              </a>
            </div>
            <p className="text-[14px] text-ink-3">
              {t("free", { count: PLANS.FREE.analysesPerMonth })}
              {/* A short phone keeps the headline, lede, first action and six statuses: this half goes. */}
              <span className="max-lg:[@media(max-height:700px)]:hidden"> {t("anyField")}</span>
            </p>
          </div>
        </div>
        <HeroFigure mode={mode} started={started} run={run} reduce={reduce} onReplay={replay} onSceneFailed={failScene} />
      </div>
    </section>
  );
}
