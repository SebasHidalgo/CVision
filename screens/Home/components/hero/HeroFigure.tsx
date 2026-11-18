"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExampleCase } from "@/screens/Home/hooks/useExampleCase";
import { markReady } from "@/screens/Home/utils/readiness";
import { cn } from "@/lib/utils";
import { FigureCaption } from "./FigureCaption";
import { FigureLegend } from "./FigureLegend";
import { FlatFigure } from "./FlatFigure";
import { SceneBoundary } from "./SceneBoundary";
import type { SceneFaces } from "./scene/textures";
import type { FigureMode } from "./useFigureMode";

// three.js and R3F live only in this chunk, requested once the hero knows it will draw the 3D figure.
const HeroScene = dynamic(
  () =>
    import("./scene/HeroScene").then((m) => {
      markReady("scene-chunk");
      return m.HeroScene;
    }),
  { ssr: false, loading: () => null },
);

type Props = {
  mode: FigureMode | null;
  started: boolean;
  run: number;
  reduce: boolean;
  onReplay: () => void;
  /** The 3D figure could not draw (chunk, scene or GPU): switch to the HTML figure for good. */
  onSceneFailed: () => void;
};

/** The computed font stacks the page uses, read from elements that set them (never from the tokens). */
function readFaces(root: HTMLElement): SceneFaces {
  const family = (el: Element | null, fallback: string) => (el ? getComputedStyle(el).fontFamily : "") || fallback;
  const section = root.closest("[data-hero-section]") ?? root;
  return {
    display: family(section.querySelector("[data-face=display]"), "Georgia, serif"),
    text: family(root, "ui-sans-serif, system-ui, sans-serif"),
    mono: family(section.querySelector("[data-face=mono]"), "ui-monospace, monospace"),
  };
}

/**
 * The hero's figure. Desktop: a frame with the 3D scene (or the HTML figure side by side when the scene cannot run),
 * the legend of the six requirements and the caption. Under 1024 px: the HTML figure, stacked, and the caption.
 */
export function HeroFigure({ mode, started, run, reduce, onReplay, onSceneFailed }: Props) {
  const { t } = useTranslation("landingHero");
  const example = useExampleCase();
  const root = useRef<HTMLDivElement>(null);
  const [faces, setFaces] = useState<SceneFaces | null>(null);
  const [lite, setLite] = useState(false);
  // Hover and keyboard focus stress a requirement while they last; a click pins one.
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const focus = hovered ?? pinned;
  const focused = example.requirements.find((r) => r.id === focus) ?? null;
  const wide = mode === "scene" || mode === "flat";

  useEffect(() => {
    if (mode !== "scene" || faces || !root.current) return;
    setFaces(readFaces(root.current));
    setLite((navigator.hardwareConcurrency ?? 8) <= 4);
  }, [mode, faces]);

  // The loader never waits for a scene that will not draw.
  useEffect(() => {
    if (mode && mode !== "scene") {
      markReady("scene-chunk");
      markReady("scene-frame");
    }
  }, [mode]);

  const pin = useCallback((id: string) => setPinned((p) => (p === id ? null : id)), []);
  const firstFrame = useCallback(() => markReady("scene-frame"), []);

  return (
    <div ref={root} className="mt-4 lg:mt-[clamp(10px,2.2svh,28px)] lg:flex lg:min-h-0 lg:flex-1 lg:basis-0 lg:flex-col">
      <div className={cn("relative hidden min-h-[180px] flex-1 basis-0", mode !== "flat" && "lg:block")}>
        <p aria-hidden className="pointer-events-none absolute top-3 right-0 z-[2] flex gap-2.5 text-[12.5px] text-ed-ink-3">
          <span>{t("figure.posting", { company: example.company })}</span>
          <span data-face="mono" className="ed-mono">
            {"↔"}
          </span>
          <span>{t("figure.cv", { name: example.candidate })}</span>
        </p>
        {mode === "scene" && faces && (
          <SceneBoundary onError={onSceneFailed}>
            <HeroScene
              requirements={example.requirements}
              cvLines={example.cvLines}
              head={t("figure.sceneHead")}
              faces={faces}
              lite={lite}
              playing={started}
              run={run}
              focus={focus}
              onFirstFrame={firstFrame}
              onLost={onSceneFailed}
            />
          </SceneBoundary>
        )}
      </div>

      <FlatFigure
        layout={mode === "flat" ? "flat" : "compact"}
        className={mode === "flat" ? "lg:min-h-[180px] lg:flex-1 lg:basis-0" : "lg:hidden"}
        requirements={example.requirements}
        cvLines={example.cvLines}
        company={example.company}
        candidate={example.candidate}
        started={started}
        run={run}
        reduce={reduce}
        focus={focus}
        pinned={pinned}
        onPin={pin}
        loaderTarget={!wide}
        heroFit={!wide}
      />

      <FigureLegend
        className="hidden flex-none lg:grid"
        requirements={example.requirements}
        pinned={pinned}
        onHover={setHovered}
        onPin={pin}
        loaderTarget={wide}
      />

      <FigureCaption
        requirements={example.requirements}
        role={example.role}
        company={example.company}
        focused={focused}
        onReplay={reduce ? null : onReplay}
      />
    </div>
  );
}
