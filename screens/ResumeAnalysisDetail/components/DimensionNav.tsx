"use client";

import { useEffect, useState } from "react";
import ScoreMeter from "@/components/score/ScoreMeter";
import { ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DimensionId } from "../utils/dimensions";

type NavItem = { id: DimensionId; label: string; score: number };

type DimensionNavProps = {
  items: NavItem[];
};

/**
 * Section index. A horizontal strip under the header on small screens, a
 * sticky column with mini meters on large ones. Tracks the section in view.
 */
export default function DimensionNav({ items }: DimensionNavProps) {
  const [active, setActive] = useState<DimensionId>(items[0]?.id ?? "ats");

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);

    // The band between 20% and 45% of the viewport decides which is "current".
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id as DimensionId);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: 0 },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      aria-label="Dimensions"
      className="sticky top-14 z-30 -mx-[clamp(1.25rem,4vw,3rem)] bg-paper/95 backdrop-blur-[6px] lg:top-28 lg:mx-0 lg:bg-transparent lg:backdrop-blur-none"
    >
      <ol className="flex gap-2 overflow-x-auto px-[clamp(1.25rem,4vw,3rem)] py-3 [scrollbar-width:none] lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:py-0 [&::-webkit-scrollbar]:hidden">
        {items.map((item, i) => {
          const current = item.id === active;
          return (
            <li key={item.id} className="shrink-0 lg:border-t lg:border-line lg:last:border-b">
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                className={cn(
                  // Chip on small screens
                  "flex items-center gap-2 border px-3 py-1.5 font-mono text-[11px] whitespace-nowrap transition-colors duration-200",
                  current
                    ? "border-ink bg-ink text-paper"
                    : "border-line-strong text-ink-2 hover:border-ink",
                  // Row on large screens
                  "lg:grid lg:grid-cols-[2.25rem_1fr_2.5rem] lg:items-center lg:gap-x-3 lg:gap-y-2 lg:border-0 lg:bg-transparent lg:px-0 lg:py-4 lg:font-sans lg:text-sm lg:text-ink-3 lg:hover:text-ink",
                  current && "lg:text-ink",
                )}
              >
                <span
                  className={cn(
                    "hidden font-mono text-[11px] tracking-[0.14em] transition-colors duration-300 lg:block",
                    current ? "text-signal" : "text-ink-3",
                  )}
                >
                  {ordinal(i)}
                </span>
                <span className="font-medium lg:whitespace-normal">{item.label}</span>
                <span className="tabular lg:figure lg:text-right lg:text-2xl lg:text-ink">
                  {item.score}
                </span>
                <span className="hidden lg:col-span-3 lg:block">
                  <ScoreMeter
                    score={item.score}
                    size="sm"
                    reveal="mount"
                    delay={0.3 + i * 0.06}
                    label={`${item.label} score`}
                  />
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
