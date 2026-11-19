"use client";

import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CAP, THIN_SCROLL } from "@/components/interview/ui";
import { INTERVIEW_LANGUAGES, type InterviewLanguage } from "@/lib/ai/postingLanguage";
import { cn } from "@/lib/utils";
import { RoomTranscript, type TranscriptLine } from "./RoomTranscript";
import type { Turn } from "./turn";
import { VoiceMeter, type MeterLevels } from "./VoiceMeter";

/** The status words, by their key under `interview:room.status`. */
export type RoomStatus =
  | "ready"
  | "connecting"
  | "queued"
  | "speaking"
  | "waiting"
  | "yourTurn"
  | "ending"
  | "ended"
  | "endedEarly"
  | "dropped"
  | "noStarts"
  | "voiceDown"
  | "noInterviews";

/** What the turn reads as in words while a call is live. */
export const TURN_STATUS: Record<Turn, RoomStatus> = { interviewer: "speaking", waiting: "waiting", candidate: "yourTurn" };

export type RoomClock = {
  /** Before the call the room shows the length; during it, the time left. */
  label: "timeLeft" | "length";
  text: string;
  /** The paid time is over and the text says so in words, not figures. */
  closing?: boolean;
};

export type RoomFacts = {
  minutes: number;
  /** What this start uses, said before it. */
  source: string | null;
  language: InterviewLanguage;
  /** Without it the language is shown, not chosen (the landing's replica). */
  onLanguage?: (language: InterviewLanguage) => void;
};

export type RoomNotice = { text: string; tone: "hint" | "strong" | "problem" };

/**
 * The parts every room renders, in document order, tagged `data-room-part`: the app's room and the landing's replica
 * are one component tree, and a test compares them by these. Some parts appear only in some states (`facts` before
 * the call, `panel` after a drop or with an offer, `action` when there is something to press).
 */
export const ROOM_PARTS = ["frame", "header", "role", "company", "attempt", "clock", "body", "presence", "status", "meter", "facts", "panel", "transcript", "log", "footer", "notice", "action"] as const;

export type RoomViewProps = {
  /** page: the app's room, the viewport under the header; replica: the landing's copy, inside its frame. */
  variant: "page" | "replica";
  /** Starting, live or ending: on a phone the room then fills the screen, so the transcript stays above the controls. */
  inCall: boolean;
  attempt: number;
  role: string;
  company: string;
  status: RoomStatus;
  /** Who holds the turn, while a call is live. */
  turn: Turn | null;
  /** The speaking indicator; hidden when the room has no call to offer. */
  meter: { candidate: string; levels: MeterLevels | null } | null;
  clock: RoomClock | null;
  facts: RoomFacts | null;
  /** What the room says under the indicator: a dropped call, an offer, the queue. */
  panel?: React.ReactNode;
  lines: readonly TranscriptLine[];
  notice: RoomNotice | null;
  action?: React.ReactNode;
};

const FIELD = "flex h-11 w-full items-center rounded-ed-field border border-ed-field bg-ed-raise pr-10 pl-3 text-ed-body text-ed-ink";
const LANGUAGE_ID = "interview-language";

/**
 * The interview room as it looks, with no call behind it: header, the turn in words with its voice meters, the
 * transcript and the footer. The app's InterviewAgent drives it from a live call; the landing drives it from its
 * example script. Presentational: no SDK, no server, labels from the `interview` namespace.
 */
export function RoomView({ variant, inCall, attempt, role, company, status, turn, meter, clock, facts, panel, lines, notice, action }: RoomViewProps) {
  const { t } = useTranslation("interview");
  const page = variant === "page";
  const Heading = page ? "h1" : "h3";
  const live = status === "speaking" || status === "waiting" || status === "yourTurn";
  // A phone in a call keeps the transcript in view: below sm the room drops the attempt line and the hint, and tightens.
  const tight = inCall;

  return (
    <div
      data-room-part="frame"
      data-variant={variant}
      className={cn(
        "flex flex-col",
        page ? cn("flex-1 lg:h-[calc(100dvh-4rem-1px)] lg:flex-none", inCall && "h-[calc(100dvh-4rem-1px)] flex-none") : "h-full",
      )}
    >
      <div className={cn("flex min-h-0 w-full flex-1 flex-col", page ? cn("ed-wrap sm:pt-6", tight ? "pt-3" : "pt-4") : "px-[clamp(14px,2.4vw,28px)] pt-[18px]")}>
        <header data-room-part="header" className={cn("flex items-end justify-between gap-5 border-b border-ed-line sm:pb-4 lg:pb-5", tight ? "pb-3" : "pb-4")}>
          <div className="min-w-0">
            <Heading data-room-part="role" className="font-ed-display text-[clamp(24px,2.4vw,34px)] font-light leading-[1.1] tracking-[-0.02em] text-balance text-ed-ink [overflow-wrap:anywhere]">
              {role}
            </Heading>
            <p data-room-part="company" className="mt-1 text-ed-body text-ed-ink-2">
              {company}
            </p>
            {/* Which rehearsal this is: metadata under the title, not a label over it. */}
            <p data-room-part="attempt" className={cn(CAP, "mt-2 text-ed-ink-2", tight && "max-sm:hidden")}>
              {t("room.eyebrow", { attempt })}
            </p>
          </div>
          {clock && (
            <div data-room-part="clock" className="shrink-0 text-right">
              <p aria-hidden className={cn(CAP, "text-ed-ink-2")}>
                {t(`room.clock.${clock.label}`)}
              </p>
              <p
                role="timer"
                aria-label={t(`room.clock.${clock.label}`)}
                className={cn("mt-1.5 text-ed-ink", clock.closing ? "max-w-[10rem] text-ed-small font-semibold" : "ed-mono text-[clamp(26px,2.4vw,36px)] leading-none")}
              >
                {clock.text}
              </p>
            </div>
          )}
        </header>

        <div data-room-part="body" className={cn("flex min-h-0 flex-1 flex-col sm:gap-4 sm:py-4 lg:grid lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)] lg:gap-6 lg:py-6", tight ? "gap-3 py-3" : "gap-4 py-4")}>
          <div
            data-room-part="presence"
            className={cn("ed-surface flex shrink-0 flex-col sm:p-5 lg:col-span-5 lg:max-h-full lg:self-start lg:overflow-y-auto lg:p-6", tight ? "p-4" : "p-5", THIN_SCROLL)}
          >
            <p
              data-room-part="status"
              data-turn={live && turn ? turn : undefined}
              className={cn("font-ed-display font-light leading-[1.08] tracking-[-0.02em] text-balance text-ed-ink sm:text-[clamp(26px,2.5vw,38px)]", tight ? "text-[23px]" : "text-[26px]")}
            >
              {t(`room.status.${status}`)}
            </p>
            {meter && (
              <VoiceMeter
                className={cn("sm:mt-4 lg:mt-6", tight ? "mt-3" : "mt-4")}
                compact={tight}
                turn={live ? turn : null}
                levels={meter.levels}
                labels={{ interviewer: t("room.interviewer"), candidate: meter.candidate }}
              />
            )}
            {facts && <Facts facts={facts} />}
            {panel && (
              <div data-room-part="panel" className="mt-5 border-t border-ed-line pt-5 lg:mt-6">
                {panel}
              </div>
            )}
          </div>

          <RoomTranscript
            lines={lines}
            live={live}
            announce={page}
            titleAs={page ? "h2" : "h4"}
            className={cn(
              "lg:col-span-7 lg:h-auto",
              page ? (inCall ? "min-h-40 flex-1" : "h-[clamp(14rem,42dvh,22rem)]") : "h-[300px]",
            )}
          />
        </div>

        <footer
          data-room-part="footer"
          className={cn(
            "flex flex-col gap-3 border-t border-ed-line sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-4",
            tight ? "py-3" : "py-4",
            page && "sticky bottom-0 z-10 -mx-ed-pad bg-ed-bg px-ed-pad",
          )}
        >
          {/* The page's status region while the footer has something to say. A blocked room's footer is empty, and its panel
              (a purchase landing) announces itself: one region at a time. */}
          <div data-room-part="notice" role={page && (notice || action) ? "status" : undefined} className={cn("min-w-0 max-w-[68ch] text-ed-body sm:min-h-6", !(tight && notice?.tone === "hint") && "min-h-6")}>
            {notice && <Notice notice={notice} hideOnPhone={tight && notice.tone === "hint"} />}
          </div>
          {action && (
            <div data-room-part="action" className="flex shrink-0 sm:justify-end">
              {action}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

function Notice({ notice, hideOnPhone }: { notice: RoomNotice; hideOnPhone: boolean }) {
  if (notice.tone === "problem") {
    return (
      <p className="flex items-start gap-2.5 text-ed-danger-text">
        <span aria-hidden className="mt-[9px] size-1.5 flex-none bg-current" />
        {notice.text}
      </p>
    );
  }
  // A phone in a call has no room for a hint: the warnings and problems stay.
  return <p className={cn(notice.tone === "strong" ? "font-medium text-ed-ink" : "text-ed-ink-2", hideOnPhone && "max-sm:hidden")}>{notice.text}</p>;
}

function Facts({ facts }: { facts: RoomFacts }) {
  const { t } = useTranslation("interview");
  const label = t("room.language.label");
  const choose = facts.onLanguage;
  return (
    <dl data-room-part="facts" className="mt-5 grid gap-5 border-t border-ed-line pt-5 text-ed-body lg:mt-6">
      <div>
        <dt className={cn(CAP, "text-ed-ink-2")}>{t("room.length")}</dt>
        <dd className="mt-1.5 text-ed-ink">{t("room.upTo", { count: facts.minutes })}</dd>
        {facts.source && <dd className="mt-1 text-ed-ink-2">{facts.source}</dd>}
      </div>
      <div>
        <dt className={cn(CAP, "text-ed-ink-2")}>{choose ? <label htmlFor={LANGUAGE_ID}>{label}</label> : label}</dt>
        <dd className="relative mt-2">
          {choose ? (
            <select
              id={LANGUAGE_ID}
              value={facts.language}
              onChange={(event) => choose(event.target.value as InterviewLanguage)}
              className={cn(FIELD, "cursor-pointer appearance-none transition-colors duration-200 hover:border-ed-ink-2 motion-reduce:transition-none")}
            >
              {INTERVIEW_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {t(`room.language.${code}`)}
                </option>
              ))}
            </select>
          ) : (
            <span className={FIELD}>{t(`room.language.${facts.language}`)}</span>
          )}
          <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ed-ink-2" />
        </dd>
        {/* Short desktop screens keep the facts without the note. */}
        <dd className="mt-2 text-ed-ink-2 lg:[@media(max-height:760px)]:hidden">{t("room.language.note")}</dd>
      </div>
    </dl>
  );
}

/** A dropped call's or an offer's main line, in the room's panel. */
export function PanelLine({ children, className, ...rest }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-ed-body text-ed-ink", className)} {...rest}>
      {children}
    </p>
  );
}

/** The panel's second line: what the candidate can do about it. */
export function PanelSub({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-2 text-ed-body text-ed-ink-2", className)}>{children}</p>;
}
