import type { Locale } from "@/lib/i18n/config";
import { INTERVIEW_TIERS } from "@/lib/plans";

// The example conversation: eight lines of a 12-minute call, said by AI voices (public/landing/voice/<locale>/).
// Structure only: the words are talk.lines.* in locales/<locale>/landingInterview.json. `at` is the call time the
// app's transcript would show (the same in every language); `seconds` is each locale's audio length, which paces the
// excerpt with the sound on or off.

export type Who = "e" | "c";

export const TALK_LINE_IDS = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"] as const;
export type TalkLineId = (typeof TALK_LINE_IDS)[number];

export type TalkLineData = {
  readonly id: TalkLineId;
  readonly who: Who;
  /** Seconds into the full call. */
  readonly at: number;
  /** Length of the audio file, per locale. */
  readonly seconds: Readonly<Record<Locale, number>>;
};

export const TALK_LINES: readonly TalkLineData[] = [
  { id: "l1", who: "e", at: 0, seconds: { es: 16.21, en: 10.72 } },
  { id: "l2", who: "c", at: 17, seconds: { es: 11.19, en: 9.83 } },
  { id: "l3", who: "e", at: 47, seconds: { es: 8.59, en: 4.71 } },
  { id: "l4", who: "c", at: 58, seconds: { es: 4.5, en: 3.69 } },
  { id: "l5", who: "e", at: 74, seconds: { es: 3.62, en: 2.67 } },
  { id: "l6", who: "c", at: 81, seconds: { es: 4.83, en: 3.87 } },
  { id: "l7", who: "e", at: 102, seconds: { es: 4.88, en: 3.32 } },
  { id: "l8", who: "c", at: 109, seconds: { es: 6.73, en: 5.07 } },
];

/** Silence between two lines of the excerpt, seconds. */
export const TALK_GAP = 0.4;
const LEAD_IN = 0.3;
const TAIL = 0.8;

export type TimedLine = {
  readonly id: TalkLineId;
  readonly who: Who;
  readonly at: number;
  readonly seconds: number;
  /** Start within the excerpt, seconds. */
  readonly start: number;
};

/** One locale's excerpt: when each line plays, and when it is over. */
export type Timeline = { readonly lines: readonly TimedLine[]; readonly end: number };

function build(locale: Locale): Timeline {
  const lines: TimedLine[] = [];
  for (const l of TALK_LINES) {
    const prev = lines[lines.length - 1];
    lines.push({ id: l.id, who: l.who, at: l.at, seconds: l.seconds[locale], start: prev ? prev.start + prev.seconds + TALK_GAP : LEAD_IN });
  }
  const last = lines[lines.length - 1];
  return { lines, end: last.start + last.seconds + TAIL };
}

const TIMELINES: Record<Locale, Timeline> = { en: build("en"), es: build("es") };

export function timelineFor(locale: Locale): Timeline {
  return TIMELINES[locale];
}

/** A line's audio. Only ever requested once the reader turns the sound on. */
export function audioSrc(locale: Locale, index: number): string {
  return `/landing/voice/${locale}/${String(index + 1).padStart(2, "0")}.mp3`;
}

/** The full interview's length, the clock the room counts down from. */
export const PRO_SECONDS = INTERVIEW_TIERS.FULL.seconds;

/** The index of the line being said at time t (or the last one said), -1 before the first. */
export function lineAt(timeline: Timeline, t: number): number {
  let i = -1;
  for (let k = 0; k < timeline.lines.length; k++) if (t >= timeline.lines[k].start) i = k;
  return i;
}

/** Call time at excerpt time t: within a line it runs at real speed; the gaps skip what the excerpt cut. */
export function callTimeAt(timeline: Timeline, t: number): number {
  const i = lineAt(timeline, t);
  if (i < 0) return 0;
  const l = timeline.lines[i];
  const next = timeline.lines[i + 1]?.at ?? l.at + l.seconds;
  return l.at + Math.min(t - l.start, next - l.at);
}

/** "4:05". */
export function clock(seconds: number): string {
  const v = Math.max(0, Math.round(seconds));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

/** Where the excerpt is, and its controls. */
export type TalkState = {
  /** Seconds into the excerpt. */
  t: number;
  /** Line being said (or last said); -1 before the first. */
  index: number;
  started: boolean;
  ended: boolean;
  playing: boolean;
  sound: boolean;
  /** Sound on, a line's audio still downloading. */
  loading: boolean;
  play: () => void;
  pause: () => void;
  replay: () => void;
  toggleSound: () => void;
  /** The whole conversation and its result at once (reduced motion, or a reader who skips). */
  finish: () => void;
};
