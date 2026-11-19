"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { speechLevel } from "@/components/interview/room/levels";
import { RoomButton } from "@/components/interview/room/RoomButton";
import { RoomView, TURN_STATUS, type RoomStatus } from "@/components/interview/room/RoomView";
import type { Locale } from "@/lib/i18n/config";
import { PLANS } from "@/lib/plans";
import { callTimeAt, clock, PRO_SECONDS, turnAt, turnEventsFor, voiceAt, type TalkState, type Who } from "./talk";
import type { Script } from "./useTalkScript";

/** The excerpt's call is the first attempt of a Pro interview, with all of the period's interviews left. */
const ATTEMPT = 1;
const PERIOD_LEFT = PLANS.PRO.interviewsPerMonth;

/**
 * The app's interview room (components/interview/room, the view InterviewAgent renders), driven by the example
 * conversation: who holds the turn by the app's own rule, the voice meters, the live transcript and the clock. Its
 * one button plays and ends the excerpt.
 */
export function Room({ talk, script, role, company, candidate, locale }: { talk: TalkState; script: Script; role: string; company: string; candidate: string; locale: Locale }) {
  const { t } = useTranslation("interview");
  const { started, ended } = talk;
  const now = talk.t;
  const live = started && !ended;
  const events = useMemo(() => turnEventsFor(script), [script]);
  const turn = live ? turnAt(events, now) : null;
  const status: RoomStatus = !started ? "ready" : ended ? "ended" : TURN_STATUS[turn ?? "waiting"];
  // An interviewer line arrives as it starts (the agent's text comes with its audio); an answer, once it is said.
  const shown = script.lines.filter((l, i) => ended || (i <= talk.index && (l.who === "e" ? now >= l.start : now >= l.start + l.seconds)));
  const remaining = started ? PRO_SECONDS - callTimeAt(script, ended ? script.end : now) : PRO_SECONDS;

  // The meters read the excerpt on every frame: an invented voice while a line plays, silence between lines and on pause.
  const at = useRef({ t: now, playing: talk.playing, script });
  useEffect(() => {
    at.current = { t: now, playing: talk.playing, script };
  });
  const levels = useMemo(() => {
    const level = (who: Who, seed: number) => () => {
      const { t: time, playing, script: lines } = at.current;
      return playing && voiceAt(lines, time) === who ? speechLevel(performance.now(), seed) : 0;
    };
    return { interviewer: level("e", 0.7), candidate: level("c", 2.3) };
  }, []);

  return (
    <RoomView
      variant="replica"
      inCall={live}
      attempt={ATTEMPT}
      role={role}
      company={company}
      status={status}
      turn={turn}
      meter={{ candidate, levels: live ? levels : null }}
      clock={{ label: live ? "timeLeft" : "length", text: clock(remaining) }}
      facts={started ? null : { minutes: PRO_SECONDS / 60, source: t("room.source.period", { count: PERIOD_LEFT, limit: PERIOD_LEFT }), language: locale }}
      lines={shown.map((l) => ({ role: l.who === "e" ? "agent" : "user", text: l.text }))}
      notice={{ text: t(`room.hint.${live ? "live" : ended ? "ended" : "idle"}`), tone: "hint" }}
      action={
        // One button whose job changes, so keyboard focus stays on it from Start to End to the feedback.
        <RoomButton
          tone={live ? "danger" : "primary"}
          icon={!started ? "call" : live ? "end" : undefined}
          busy={ended}
          aria-disabled={ended || undefined}
          onClick={!started ? talk.play : live ? talk.finish : undefined}
        >
          {!started ? t("room.startButton.start") : live ? t("room.end") : t("room.openingFeedback")}
        </RoomButton>
      }
    />
  );
}
