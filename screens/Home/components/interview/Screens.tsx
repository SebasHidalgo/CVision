"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useExampleCase } from "@/screens/Home/hooks/useExampleCase";
import { BRAND } from "@/lib/brand";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { ANSWERED_GAPS } from "@/screens/Home/utils/exampleCase";
import { answerLineAt } from "./exampleReport";
import { Report } from "./Report";
import { Room } from "./Room";
import type { TalkState } from "./talk";
import type { Script } from "./useTalkScript";

type View = "during" | "after";
const VIEWS: readonly View[] = ["during", "after"];
/** The address bar of each screen: the app's routes, with an invented id. */
const PATH: Record<View, string> = { during: "/interview/8c1f…", after: "/interview/8c1f…/feedback" };
/** How long the room says "Opening your feedback" before the frame turns to it. */
const OPEN_FEEDBACK_MS = 1400;
const PANEL_H = "lg:h-[clamp(540px,68vh,680px)]";

/**
 * The app's room and feedback page in one frame, with a During / After switch. When the call ends the frame opens
 * the feedback, as the app does, unless the reader already picked a screen; under reduced motion the excerpt starts
 * finished (nobody watched it end), so the room stays, complete.
 */
export function Screens({ talk, script, reduce, locale }: { talk: TalkState; script: Script; reduce: boolean; locale: Locale }) {
  const { t } = useTranslation("landingInterview");
  const { t: tc } = useTranslation("common");
  const { t: tl } = useTranslation("landing");
  const example = useExampleCase();
  const [view, setView] = useState<View>("during");
  const chose = useRef(false);
  const auto = useRef(false);
  const focusReport = useRef(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const roomPanel = useRef<HTMLDivElement>(null);
  const reportPanel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (talk.ended && !chose.current && !reduce) {
      const timer = window.setTimeout(() => {
        if (chose.current) return; // picked a screen while the room was closing
        auto.current = true;
        // Focus inside the room would be lost when it hides: it follows the reader to the feedback.
        focusReport.current = !!roomPanel.current?.contains(document.activeElement);
        setView("after");
      }, OPEN_FEEDBACK_MS);
      return () => window.clearTimeout(timer);
    }
    if (!talk.ended && auto.current) {
      auto.current = false;
      setView("during");
    }
  }, [talk.ended, reduce]);

  useEffect(() => {
    if (view === "after" && focusReport.current) {
      focusReport.current = false;
      reportPanel.current?.focus();
    }
  }, [view]);

  const pick = useCallback((next: View) => {
    chose.current = true;
    auto.current = false;
    setView(next);
  }, []);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length;
    pick(VIEWS[next]);
    tabs.current[next]?.focus();
  };

  // The two answered gaps are quoted as the analysis section quotes them; any other line as it was said.
  const quoteOf = useCallback(
    (line: number) => {
      const gap = ANSWERED_GAPS.find((g) => answerLineAt(g.at) === line);
      return gap ? tl(`case.answers.${gap.req}`) : (script.lines[line]?.text ?? "");
    },
    [tl, script],
  );

  const initials = example.candidate
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2);

  return (
    <div className="grid gap-3.5">
      <div role="tablist" aria-label={t("screens.label")} className="flex gap-1 rounded-[12px] border border-line-2 bg-panel p-1 lg:justify-self-start">
        {VIEWS.map((v, i) => (
          <button
            key={v}
            ref={(el) => void (tabs.current[i] = el)}
            type="button"
            role="tab"
            id={`${id}-tab-${v}`}
            aria-selected={view === v}
            aria-controls={`${id}-panel-${v}`}
            tabIndex={view === v ? 0 : -1}
            onClick={() => pick(v)}
            onKeyDown={(e) => onKey(e, i)}
            className="grid min-h-11 min-w-0 flex-1 cursor-pointer gap-0.5 rounded-[9px] border-0 bg-transparent px-[18px] py-2 text-left text-[15px] font-semibold text-ink-2 transition-colors duration-150 hover:text-ink focus-visible:rounded-[9px]! aria-selected:bg-raise aria-selected:text-ink aria-selected:shadow-[inset_0_0_0_1px_var(--color-line-2)] motion-reduce:transition-none lg:flex-none"
          >
            {v === "during" ? t("screens.during") : t("screens.after")}{" "}
            <span className="text-[12.5px] font-normal text-ink-2">{v === "during" ? t("screens.duringSub") : t("screens.afterSub")}</span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-[12px] border border-line-2 bg-bg shadow-[0_1px_0_rgb(0_0_0/0.6),0_10px_16px_-10px_rgb(0_0_0/0.8)]">
        <div aria-hidden className="flex h-[34px] items-center gap-3.5 border-b border-line bg-panel px-3">
          <span className="inline-flex gap-1.5">
            <i className="size-[9px] rounded-full bg-line-2" />
            <i className="size-[9px] rounded-full bg-line-2" />
            <i className="size-[9px] rounded-full bg-line-2" />
          </span>
          <span className="rounded-[6px] border border-line bg-bg px-2.5 py-[3px] font-mono text-[12px] text-ink-2">{PATH[view]}</span>
        </div>
        <div aria-hidden className="flex h-12 items-center gap-[22px] border-b border-line px-[clamp(14px,2.4vw,28px)] text-[13.5px] text-ink-2">
          <span className="inline-flex items-baseline gap-0.5 font-display text-[19px] font-medium tracking-[-0.02em] text-ink">
            {BRAND.name}
            <i className="inline-block size-[5px] bg-ink" />
          </span>
          <span className="hidden gap-[18px] lg:inline-flex">
            <span>{tc("nav.analyses")}</span>
            <span className="text-ink shadow-[0_1px_0_var(--color-ink)]">{tc("nav.interviews")}</span>
          </span>
          <span className="ml-auto hidden rounded-full bg-ink px-3 py-[5px] text-[13px] font-semibold text-bg lg:inline">{tc("nav.newAnalysis")}</span>
          <span className="ml-auto grid size-7 place-items-center rounded-full border border-line-2 bg-raise text-[11px] text-ink lg:ml-0">{initials}</span>
        </div>
        <div ref={roomPanel} id={`${id}-panel-during`} role="tabpanel" aria-labelledby={`${id}-tab-during`} hidden={view !== "during"} className={PANEL_H}>
          <Room talk={talk} script={script} role={example.role} company={example.company} candidate={example.candidate} locale={locale} />
        </div>
        <div
          ref={reportPanel}
          id={`${id}-panel-after`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-after`}
          hidden={view !== "after"}
          tabIndex={0}
          className={cn(
            "h-[560px] overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:var(--color-line-2)_transparent] focus-visible:outline-offset-[-2px]!",
            PANEL_H,
          )}
        >
          <Report script={script} role={example.role} requirements={example.requirements} quoteOf={quoteOf} locale={locale} />
        </div>
      </div>
      <p className="max-w-[70ch] text-[13.5px] text-ink-2">{t("screens.note")}</p>
    </div>
  );
}
