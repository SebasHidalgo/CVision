"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CAP, THIN_SCROLL } from "@/components/interview/ui";
import { TranscriptLines } from "@/components/interview/TranscriptLines";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useMediaQuery";

/** One finished line of the call, in the roles the platform uses. */
export type TranscriptLine = {
  role: "agent" | "user";
  text: string;
};

/** Within this many pixels of the end, the reader is at the newest line. */
const BOTTOM_SLACK_PX = 24;
/** A scroll this soon after the reader's own input is theirs. */
const USER_INPUT_MS = 1_000;

/** The id the box's heading carries: the room has one transcript. */
const TRANSCRIPT_TITLE_ID = "live-transcript-title";

/**
 * The call as a script, in its own scroll: follows the newest line; only the reader's own wheel, touch or keys leave
 * it, and a jump button brings them back. Display only: what is shown here is never sent anywhere.
 */
export function RoomTranscript({
  lines,
  live,
  announce,
  titleAs: Title = "h2",
  className,
}: {
  lines: readonly TranscriptLine[];
  live: boolean;
  /** Read new lines to a screen reader (the app's room); a replica that plays by itself stays quiet. */
  announce: boolean;
  /** The heading level that fits the page around the room. */
  titleAs?: "h2" | "h4";
  className?: string;
}) {
  const { t } = useTranslation("interview");
  const reduce = useReducedMotion();
  const logRef = useRef<HTMLDivElement>(null);
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
      if (!log || typeof log.scrollTo !== "function") return;
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
      if (followingRef.current) toBottom(false);
    });
    observer.observe(log);
    return () => observer.disconnect();
  }, [toBottom]);

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
    <section data-room-part="transcript" aria-labelledby={TRANSCRIPT_TITLE_ID} className={cn("ed-surface flex min-h-0 flex-col", className)}>
      <header className="flex items-baseline justify-between gap-4 border-b border-ed-line px-5 py-3.5 lg:px-7">
        <Title id={TRANSCRIPT_TITLE_ID} className={cn(CAP, "text-ed-ink-2")}>
          {t("room.transcript.title")}
        </Title>
        <span className={cn(CAP, "tabular-nums text-ed-ink-2")}>
          {lines.length === 0 ? (live ? t("room.transcript.listening") : t("room.transcript.empty")) : t("room.transcript.lines", { count: lines.length })}
        </span>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={logRef}
          data-room-part="log"
          role="log"
          aria-live={announce ? "polite" : "off"}
          aria-relevant="additions"
          tabIndex={0}
          aria-label={t("room.transcript.label")}
          onScroll={onScroll}
          onWheel={markUserInput}
          onTouchStart={markUserInput}
          onTouchMove={markUserInput}
          onKeyDown={markUserInput}
          onPointerDown={markUserInput}
          className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-5 [overscroll-behavior:contain] focus-visible:outline-offset-[-3px]! lg:px-7", THIN_SCROLL)}
        >
          {lines.length === 0 ? (
            <p className="max-w-[44ch] text-ed-body text-ed-ink-2">{live ? t("room.transcript.emptyLive") : t("room.transcript.emptyIdle")}</p>
          ) : (
            <TranscriptLines
              animate
              entries={lines.map((line, i) => ({ kind: "line" as const, key: i, who: line.role === "user" ? ("candidate" as const) : ("interviewer" as const), text: line.text }))}
              labels={{ interviewer: t("room.interviewer"), candidate: t("room.you") }}
            />
          )}
        </div>

        {!following && lines.length > 0 && (
          <button
            type="button"
            onClick={jump}
            aria-label={unseen ? undefined : t("room.transcript.backToNewest")}
            className="absolute bottom-3 left-1/2 inline-flex min-h-11 min-w-11 -translate-x-1/2 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-ed-line-2 bg-ed-raise px-3.5 text-ed-small font-semibold text-ed-ink shadow-ed-surface transition-colors duration-200 hover:border-ed-ink-2 motion-reduce:transition-none"
          >
            {unseen && t("room.transcript.newMessages")}
            <ArrowDown aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </section>
  );
}
