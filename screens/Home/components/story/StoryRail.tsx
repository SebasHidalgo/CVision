"use client";

import { useTranslation } from "react-i18next";
import { pad2, STEP_IDS } from "./storyData";

type StoryRailProps = {
  active: number;
  onGo: (i: number) => void;
  /** Receives `--p` (0 to 1) from useActiveStep: how far the line is filled. */
  railRef: React.Ref<HTMLElement>;
};

// The last stop sits at the start of the last column, so a full read fills (n - 1) / n of the line.
const FILL_SHARE = (STEP_IDS.length - 1) / STEP_IDS.length;

/** The story's index: one stop per step on a line that fills as you read. Each stop jumps to its step. */
export function StoryRail({ active, onGo, railRef }: StoryRailProps) {
  const { t } = useTranslation("landingStory");
  return (
    <nav ref={railRef} aria-label={t("rail.label")} className="relative pb-0.5">
      <ol className="grid" style={{ gridTemplateColumns: `repeat(${STEP_IDS.length}, minmax(0, 1fr))` }}>
        {STEP_IDS.map((id, i) => (
          <li key={id} className="grid">
            <button
              type="button"
              aria-current={active === i ? "step" : undefined}
              data-done={i < active || undefined}
              onClick={() => onGo(i)}
              className="group relative grid min-h-12 cursor-pointer content-start items-baseline gap-x-2 pb-4 pr-1.5 text-left text-ink-3 transition-colors duration-300 hover:[&:not([aria-current])]:text-ink-2 data-done:text-ink-2 aria-[current=step]:text-ink min-[1280px]:grid-cols-[auto_minmax(0,1fr)]"
            >
              <span
                aria-hidden
                className="absolute -bottom-1 left-0 z-[1] size-[9px] rounded-full border-[1.5px] border-line-2 bg-bg transition-[background-color,border-color,transform] duration-300 ease-story group-data-done:border-ink-2 group-data-done:bg-ink-2 group-aria-[current=step]:scale-[1.35] group-aria-[current=step]:border-ink group-aria-[current=step]:bg-ink motion-reduce:transition-none"
              />
              <span aria-hidden className="mono text-[13px]">
                {pad2(i + 1)}
              </span>
              {/* Below 1280 px the number sits over the label, which may then break: never an ellipsis. */}
              <span className="break-words text-[14px] font-medium leading-tight [hyphens:auto]">{t(`steps.${id}.short`)}</span>
              <span className="sr-only">: {t(`steps.${id}.title`)}</span>
            </button>
          </li>
        ))}
      </ol>
      <span aria-hidden className="absolute bottom-0 left-1 right-0 h-px bg-line-2">
        <span className="absolute inset-0 origin-left bg-ink-2" style={{ transform: `scaleX(calc(var(--p, 0) * ${FILL_SHARE}))` }} />
      </span>
    </nav>
  );
}
