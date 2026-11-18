"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Phone, PhoneOff } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import styles from "./Room.module.css";
import { callTimeAt, clock, PRO_SECONDS, type TalkState } from "./talk";
import { TranscriptList } from "./TranscriptList";
import { CAP, DISPLAY_MD, THIN_SCROLL, TICK } from "./ui";
import type { Script } from "./useTalkScript";

/** The excerpt's call is the first attempt of a Pro interview, with all of the period's interviews left. */
const ATTEMPT = 1;
const PERIOD_LEFT = PLANS.PRO.interviewsPerMonth;

const BUTTON =
  "inline-flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border-0 px-5 text-[15px] font-semibold lg:w-auto focus-visible:rounded-[10px]!";

/**
 * The app's interview room (screens/Interview/components/InterviewAgent.tsx and Transcript.tsx), driven by the example
 * conversation: who is talking, the live transcript and the clock. Its buttons play and end the excerpt.
 */
export function Room({
  talk,
  script,
  reduce,
  role,
  company,
  candidate,
  locale,
}: {
  talk: TalkState;
  script: Script;
  reduce: boolean;
  role: string;
  company: string;
  candidate: string;
  locale: Locale;
}) {
  const { t } = useTranslation("landingInterview");
  const log = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { index, started, ended } = talk;
  const now = talk.t;
  const cur = index >= 0 ? script.lines[index] : null;
  const speaking = !!cur && !ended && cur.who === "e" && now < cur.start + cur.seconds;
  const live = started && !ended;
  // An interviewer line arrives as it starts (the agent's text comes with its audio); an answer, once it is said.
  const shown = script.lines.filter((l, i) => ended || (i <= index && (l.who === "e" ? now >= l.start : now >= l.start + l.seconds)));
  const status = !started ? "ready" : ended ? "ended" : speaking ? "speaking" : "yourTurn";
  const orb = !started ? "idle" : ended ? "ended" : speaking ? "speaking" : "listening";
  const remaining = started ? PRO_SECONDS - callTimeAt(script, ended ? script.end : now) : PRO_SECONDS;

  useLayoutEffect(() => {
    const el = log.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [shown.length, reduce]);

  return (
    <div className="flex h-full flex-col px-[clamp(14px,2.4vw,28px)]">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3.5 border-b border-ed-line pt-[18px] pb-3.5">
        <div>
          <p className={cn(CAP, TICK, "text-ed-ink-2")}>{t("app.interview.room.eyebrow", { attempt: ATTEMPT })}</p>
          <h3 className={cn(DISPLAY_MD, "mt-2.5")}>{role}</h3>
          <p className="mt-1 text-[15px] text-ed-ink-2">{company}</p>
        </div>
        <div className="flex items-center gap-3">
          <span aria-hidden className={cn("size-2 rounded-full", live ? cn("bg-ed-ink", styles.blink) : "bg-ed-line-2")} />
          <span className={cn(CAP, "text-ed-ink")}>{t(`app.interview.room.status.${status}`)}</span>
          <span className={cn(CAP, "min-w-[4.2em] border-l border-ed-line pl-3 tabular-nums text-ed-ink")}>
            <span className="sr-only">{live ? t("app.interview.room.clock.timeLeft") : t("app.interview.room.clock.length")} </span>
            {clock(remaining)}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-[18px] py-[18px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-[clamp(20px,3vw,48px)]">
        <section aria-label={t("app.interview.room.interviewer")} className={cn("flex min-h-0 flex-col items-center overflow-y-auto", THIN_SCROLL)}>
          <div aria-hidden className={styles.orb} data-state={orb} data-facts={started ? undefined : ""}>
            <span className={styles.ring} />
            <span className={styles.ring} />
            <span className={styles.ring} />
            <span className={styles.core} />
          </div>
          <div className={cn("text-center", started ? "mt-[18px]" : "mt-3")}>
            <p className="font-medium text-ed-ink">{candidate}</p>
            <p className={cn(CAP, "mt-[3px] text-ed-ink-2")}>{t("app.interview.room.candidate")}</p>
          </div>
          {!started && (
            <dl className="mt-3 grid w-full max-w-[22rem] gap-2.5 text-[13.5px] leading-[1.45]">
              <div>
                <dt className={cn(CAP, "text-ed-ink-2")}>{t("app.interview.room.length")}</dt>
                <dd className="mt-[3px] text-ed-ink">{t("app.interview.room.upTo", { count: PRO_SECONDS / 60 })}</dd>
                <dd className="mt-[3px] text-ed-ink-2">{t("app.interview.room.source.period", { count: PERIOD_LEFT, limit: PERIOD_LEFT })}</dd>
              </div>
              <div>
                <dt className={cn(CAP, "text-ed-ink-2")}>{t("app.interview.room.language.label")}</dt>
                <dd className="mt-[3px] flex h-[34px] items-center border-b border-ed-line-2 text-ed-ink">{t(`app.interview.room.language.${locale}`)}</dd>
                {/* Short desktop screens keep the facts without the note. */}
                <dd className="mt-[3px] text-ed-ink-2 lg:[@media(max-height:800px)]:hidden">{t("app.interview.room.language.note")}</dd>
              </div>
            </dl>
          )}
        </section>

        <section aria-labelledby={titleId} className="flex h-[300px] min-h-0 flex-col lg:h-auto">
          <header className="flex items-baseline justify-between gap-3 border-b border-ed-line pb-2.5">
            <h4 id={titleId} className={cn(CAP, "text-ed-ink-2")}>
              {t("app.interview.room.transcript.title")}
            </h4>
            <span className={cn(CAP, "tabular-nums text-ed-ink-2")}>
              {shown.length === 0
                ? live
                  ? t("app.interview.room.transcript.listening")
                  : t("app.interview.room.transcript.empty")
                : t("app.interview.room.transcript.lines", { count: shown.length })}
            </span>
          </header>
          {/* aria-live off: the excerpt plays by itself, and announcing every line would talk over the reader. */}
          <div
            ref={log}
            role="log"
            aria-live="off"
            aria-label={t("app.interview.room.transcript.label")}
            tabIndex={0}
            className={cn("min-h-0 flex-1 overflow-y-auto pt-4 pr-1.5 pb-2", THIN_SCROLL)}
          >
            {shown.length === 0 ? (
              <p className="max-w-[22rem] text-[14px] leading-[1.55] text-ed-ink-2">
                {live ? t("app.interview.room.transcript.emptyLive") : t("app.interview.room.transcript.emptyIdle")}
              </p>
            ) : (
              <TranscriptList
                lines={shown}
                labels={{ interviewer: t("app.interview.room.interviewer"), you: t("app.interview.room.you") }}
              />
            )}
          </div>
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-ed-line pt-3 pb-4">
        <p className="text-[14px] text-ed-ink-2">{t(`app.interview.room.hint.${live ? "live" : ended ? "ended" : "idle"}`)}</p>
        {/* One button whose job changes, so keyboard focus stays on it from Start to End to the feedback. */}
        <button
          type="button"
          aria-disabled={ended || undefined}
          onClick={!started ? talk.play : live ? talk.finish : undefined}
          className={cn(
            BUTTON,
            live ? "bg-ed-danger text-white hover:bg-ed-danger-hover" : "bg-ed-ink text-ed-bg",
            ended && "cursor-default opacity-70",
          )}
        >
          {!started ? (
            <Phone aria-hidden className="size-[18px]" />
          ) : live ? (
            <PhoneOff aria-hidden className="size-[18px]" />
          ) : (
            <Loader2 aria-hidden className="size-[18px] animate-spin motion-reduce:animate-none" />
          )}
          {!started ? t("app.interview.room.startButton.start") : live ? t("app.interview.room.end") : t("app.interview.room.openingFeedback")}
        </button>
      </footer>
    </div>
  );
}
