"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One finished line of the call, in the roles the platform uses. */
export type TranscriptLine = {
  role: "agent" | "user";
  text: string;
};

type TranscriptProps = {
  lines: TranscriptLine[];
  live: boolean;
  className?: string;
};

/** Within this many pixels of the end, the reader is at the newest line. */
const BOTTOM_SLACK_PX = 24;
/** A scroll this soon after the reader's own input is theirs. */
const USER_INPUT_MS = 1_000;

/** The call as a script: follows the newest line; only the reader's own scroll leaves it. Display only. */
export default function Transcript({ lines, live, className }: TranscriptProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { t } = useTranslation("interview");
  const [following, setFollowingState] = useState(true);
  const [unseen, setUnseen] = useState(false);
  // The last wheel, touch or key on the box: a scroll right after one is the reader's.
  const userInputAt = useRef(0);
  const markUserInput = () => {
    userInputAt.current = Date.now();
  };
  // A ref set with the state, so a line arriving before the re-render sees it.
  const followingRef = useRef(true);
  const setFollowing = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowingState(value);
  }, []);
  const toBottom = useCallback(
    (smooth: boolean) => {
      const log = logRef.current;
      if (!log) return;
      log.scrollTo({ top: log.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
    },
    [reduce],
  );

  // A new or corrected line: follow it, or flag it for a reader who scrolled up.
  useLayoutEffect(() => {
    if (lines.length === 0) return;
    if (followingRef.current) toBottom(true);
    else setUnseen(true);
  }, [lines, toBottom]);

  // The box can change height (a phone rotated): a follower stays at the end.
  useEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (following) toBottom(false);
    });
    observer.observe(log);
    return () => observer.disconnect();
  }, [following, toBottom]);

  const onScroll = () => {
    const log = logRef.current;
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight <= BOTTOM_SLACK_PX;
    if (atBottom) {
      setFollowing(true);
      setUnseen(false);
      return;
    }
    if (Date.now() - userInputAt.current < USER_INPUT_MS) setFollowing(false);
  };

  const jump = () => {
    setFollowing(true);
    setUnseen(false);
    toBottom(true);
  };

  return (
    <section aria-labelledby="live-transcript-title" className={cn("relative flex min-h-0 flex-col", className)}>
      <header className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h2 id="live-transcript-title" className="eyebrow">{t("room.transcript.title")}</h2>
        <span className="eyebrow tabular">
          {lines.length === 0
            ? live
              ? t("room.transcript.listening")
              : t("room.transcript.empty")
            : t("room.transcript.lines", { count: lines.length })}
        </span>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
        aria-label={t("room.transcript.label")}
        onScroll={onScroll}
        onWheel={markUserInput}
        onTouchStart={markUserInput}
        onTouchMove={markUserInput}
        onKeyDown={markUserInput}
        onPointerDown={markUserInput}
        className="min-h-0 flex-1 overflow-y-auto py-5 pr-2 focus-visible:outline-none [scrollbar-width:thin] lg:overscroll-contain"
      >
        {lines.length === 0 ? (
          <p className="max-w-xs text-sm leading-relaxed text-ink-3">
            {live ? t("room.transcript.emptyLive") : t("room.transcript.emptyIdle")}
          </p>
        ) : (
          <ol className="grid grid-cols-1 gap-y-5 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-6">
            {lines.map((line, i) => {
              const mine = line.role === "user";
              return (
                <motion.li
                  key={i}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="grid gap-1 sm:col-span-2 sm:grid-cols-subgrid sm:gap-x-6"
                >
                  <span className={cn("eyebrow pt-1 whitespace-nowrap", mine ? "text-ink" : "text-signal")}>
                    {mine ? t("room.you") : t("room.interviewer")}
                  </span>
                  <p className={cn("min-w-0 text-[15px] leading-relaxed break-words", mine ? "text-ink-2" : "text-ink")}>{line.text}</p>
                </motion.li>
              );
            })}
          </ol>
        )}
      </div>

      {!following && lines.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={jump}
          aria-label={unseen ? undefined : t("room.transcript.backToNewest")}
          className="absolute bottom-3 left-1/2 h-11 min-w-11 -translate-x-1/2 gap-2 bg-paper shadow-sm sm:h-9 sm:min-w-9"
        >
          {unseen && t("room.transcript.newMessages")}
          <ArrowDown aria-hidden className="size-4" />
        </Button>
      )}
    </section>
  );
}
