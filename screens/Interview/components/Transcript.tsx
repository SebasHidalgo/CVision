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
/** A smooth scroll that never reports its end still hands control back after this. */
const AUTO_SCROLL_MS = 1_200;

/**
 * The conversation as a script, for the candidate's benefit during the call.
 * It scrolls inside its own box and follows the newest line while the
 * reader is at the bottom; scrolled up to read, it stays put and offers a
 * jump back. A convenience only: the scored transcript arrives by webhook,
 * and nothing shown here is ever sent anywhere.
 */
export default function Transcript({ lines, live, className }: TranscriptProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { t } = useTranslation("interview");
  const [following, setFollowing] = useState(true);
  const [unseen, setUnseen] = useState(false);
  // Read by the line effect, which must run on new lines only, not when the reader scrolls.
  const followingRef = useRef(true);
  useEffect(() => {
    followingRef.current = following;
  }, [following]);
  // A scroll the room started: its intermediate positions are not the reader leaving the bottom.
  const autoUntil = useRef(0);

  const toBottom = useCallback(
    (smooth: boolean) => {
      const log = logRef.current;
      if (!log) return;
      autoUntil.current = Date.now() + AUTO_SCROLL_MS;
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
      autoUntil.current = 0;
      setFollowing(true);
      setUnseen(false);
      return;
    }
    if (Date.now() < autoUntil.current) return;
    setFollowing(false);
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
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-5 pr-2 focus-visible:outline-none [scrollbar-width:thin]"
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

      {unseen && (
        <Button type="button" variant="outline" size="sm" onClick={jump} className="absolute bottom-3 left-1/2 -translate-x-1/2 gap-2 bg-paper shadow-sm">
          {t("room.transcript.newMessages")}
          <ArrowDown aria-hidden className="size-4" />
        </Button>
      )}
    </section>
  );
}
