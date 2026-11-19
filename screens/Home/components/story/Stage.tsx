"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { FigureContext } from "./figureContext";
import { Item } from "./FigureParts";
import { isRequirement, ITEM_KEYS, layoutOf, wirePaths } from "./layout";
import type { StepId } from "./storyData";
import styles from "./Story.module.css";

const WIRES = wirePaths();
const WIRE_HEIGHT = layoutOf("search").height;

/** The object on a large screen: one panel whose items move to each step's place. Decorative: the narration beside
 * it says everything it shows. */
export function Stage({ step, className }: { step: StepId; className?: string }) {
  const layout = layoutOf(step);
  return (
    <FigureContext value={{ mode: "stage", step }}>
      <div aria-hidden className={cn("relative", className)}>
        <div className={cn("surface", styles.obj)} style={{ height: layout.height }}>
          {ITEM_KEYS.map((key, i) => {
            const box = layout.boxes[key];
            return (
              <div
                key={key}
                data-on={box.on || undefined}
                className={cn(
                  styles.it,
                  key === "cv" && styles.slow,
                  step === "search" && isRequirement(key) && styles.flushRight,
                  step === "search" && key === "cv" && styles.flushLeft,
                )}
                style={{ left: `${box.x}%`, width: `${box.w}%`, height: box.h, transform: `translateY(${box.y}px)`, "--i": i } as CSSProperties}
              >
                <Item k={key} />
              </div>
            );
          })}
          {/* x runs in percent and y in pixels, like the boxes, so the wires stretch with the object's width. */}
          <svg className={styles.wires} viewBox={`0 0 100 ${WIRE_HEIGHT}`} preserveAspectRatio="none">
            {WIRES.map((wire, i) => (
              <path
                key={wire.id}
                d={wire.d}
                className={cn(styles.wire, step === "search" && styles.on, wire.partial && styles.partial)}
                style={{ "--i": i } as CSSProperties}
              />
            ))}
          </svg>
        </div>
      </div>
    </FigureContext>
  );
}
