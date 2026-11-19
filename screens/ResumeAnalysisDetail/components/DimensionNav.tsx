"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ordinal } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DimensionId } from "../utils/dimensions";
import { ScoreBar } from "./ScoreBar";

/** score is null for the sections that report evidence, not a number. The label comes translated. */
type NavItem = { id: DimensionId; label: string; score: number | null };

type DimensionNavProps = {
  items: NavItem[];
};

/**
 * Section index. A sticky strip under the app header on small screens, a sticky column with the scores on large
 * ones. Tracks the section in view. Its parent must be the tall report block (see the screen), or nothing sticks.
 */
export default function DimensionNav({ items }: DimensionNavProps) {
  const { t } = useTranslation("analysis");
  const [active, setActive] = useState<DimensionId>(items[0]?.id ?? "fit");
  const strip = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const sections = items.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => el !== null);

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

  // On a phone the strip scrolls sideways: keep the current pill in it. Only the strip moves, never the page.
  useEffect(() => {
    const list = strip.current;
    const link = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !link || list.scrollWidth <= list.clientWidth) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: Math.max(0, link.offsetLeft - list.clientWidth / 2 + link.offsetWidth / 2), behavior: reduce ? "auto" : "smooth" });
  }, [active]);

  return (
    <nav
      aria-label={t("nav.label")}
      className="sticky top-header z-30 -mx-pad border-b border-line bg-bg lg:top-[calc(var(--spacing-header)+32px)] lg:mx-0 lg:border-b-0 lg:bg-transparent"
    >
      <ol ref={strip} className="relative flex gap-2 overflow-x-auto px-pad py-2.5 [scrollbar-width:none] lg:flex-col lg:gap-0 lg:overflow-visible lg:border-t lg:border-line lg:px-0 lg:py-0 [&::-webkit-scrollbar]:hidden">
        {items.map((item, i) => {
          const current = item.id === active;
          return (
            <li key={item.id} className="shrink-0 lg:border-b lg:border-line">
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                className={cn(
                  // A pill on small screens (radius by breakpoint: a plain rounded-full compiles !important here)
                  "flex min-h-11 items-center gap-2 border px-4 max-lg:rounded-full text-[15px] whitespace-nowrap transition-colors duration-200",
                  current ? "border-ink bg-ink text-bg" : "border-line-2 text-ink-2 hover:border-ink-2 hover:text-ink",
                  // A row on large screens: number, label, score, and the score's bar under them
                  "lg:grid lg:grid-cols-[2rem_minmax(0,1fr)_auto] lg:gap-x-3 lg:gap-y-2.5 lg:border-0 lg:bg-transparent lg:py-3.5 lg:pr-1 lg:pl-3 lg:whitespace-normal lg:hover:text-ink",
                  current && "lg:text-ink lg:shadow-[inset_2px_0_0_var(--color-ink)]",
                )}
              >
                <span aria-hidden className="mono hidden text-[13px] text-ink-3 lg:block">
                  {ordinal(i)}
                </span>
                <span className="font-medium">{item.label}</span>
                <span className="mono text-[14px] lg:text-[15px]">{item.score ?? ""}</span>
                {item.score !== null && <ScoreBar score={item.score} className="hidden lg:col-span-3 lg:block" />}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
