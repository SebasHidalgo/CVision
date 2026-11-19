"use client";

import { memo } from "react";
import { FigureContext } from "./figureContext";
import { Item } from "./FigureParts";
import { stillOrder } from "./layout";
import type { StepId } from "./storyData";

/** The object at one step, drawn in place: on phones, and for readers who asked for less motion. Decorative, like
 * the stage. Memoized: the current step changes as the reader scrolls, and a still never depends on it. */
export const Still = memo(function Still({ step }: { step: StepId }) {
  return (
    <FigureContext value={{ mode: "still", step }}>
      <div aria-hidden className="surface grid px-5 pb-5 pt-1 text-[15px] text-ink-2">
        {stillOrder(step).map((key) => (
          <Item key={key} k={key} />
        ))}
      </div>
    </FigureContext>
  );
});
