"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Locale } from "@/lib/i18n/config";
import { audioSrc, lineAt, type TalkState, type Timeline } from "./talk";

/** 10 Hz drives the captions and a seconds clock, and keeps re-renders cheap. */
const TICK_MS = 100;
/** A line whose audio can't start in this long drops the excerpt to silent (a stalled network, a blocked player). */
const AUDIO_PATIENCE_MS = 8000;
const HAVE_FUTURE_DATA = 3;

/**
 * The excerpt's clock. Without sound it runs on wall time; with sound each line's audio drives it, and a line still
 * downloading holds it. Nothing is requested until the reader turns the sound on. Pauses while `stage` is off screen
 * or the tab is hidden, and resumes where it was. Mount it once per locale: the audio and the timing are the locale's.
 */
export function useTalk(
  stage: RefObject<HTMLElement | null>,
  { timeline, locale, reduce }: { timeline: Timeline; locale: Locale; reduce: boolean },
): TalkState {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [sound, setSound] = useState(false);
  const [loading, setLoading] = useState(false);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const soundRef = useRef(false);
  const audios = useRef<HTMLAudioElement[] | null>(null);
  const current = useRef(-1);
  const holdSince = useRef<number | null>(null);
  const resume = useRef(false);

  const seek = useCallback((value: number) => {
    tRef.current = value;
    setT(value);
  }, []);

  const run = useCallback((on: boolean) => {
    playingRef.current = on;
    setPlaying(on);
    if (on) setStarted(true);
  }, []);

  const stopAudio = useCallback(() => {
    audios.current?.forEach((a) => a.pause());
    current.current = -1;
    holdSince.current = null;
  }, []);

  const silence = useCallback(() => {
    soundRef.current = false;
    setSound(false);
    setLoading(false);
    stopAudio();
  }, [stopAudio]);

  /** Starts line i's audio at the clock's place in it. */
  const cue = useCallback(
    (i: number) => {
      const list = audios.current;
      if (!list) return;
      list.forEach((a, k) => k !== i && a.pause());
      current.current = i;
      const a = list[i];
      try {
        a.currentTime = Math.max(0, tRef.current - timeline.lines[i].start);
      } catch {
        // Not seekable yet: it starts from 0, close enough.
      }
      a.play()?.catch((error: unknown) => {
        // A pause() that interrupts play() rejects with AbortError; a refused or unplayable file means no sound.
        if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "NotSupportedError")) silence();
      });
    },
    [timeline, silence],
  );

  const pause = useCallback(() => {
    run(false);
    stopAudio();
  }, [run, stopAudio]);

  const play = useCallback(() => {
    if (tRef.current >= timeline.end) seek(0);
    run(true);
  }, [timeline, seek, run]);

  const replay = useCallback(() => {
    stopAudio();
    seek(0);
    run(true);
  }, [stopAudio, seek, run]);

  const finish = useCallback(() => {
    stopAudio();
    seek(timeline.end);
    run(false);
    setStarted(true);
  }, [timeline, stopAudio, seek, run]);

  const toggleSound = useCallback(() => {
    if (soundRef.current) {
      silence();
      return;
    }
    if (!audios.current) {
      // The first request for audio, on the click and never before. Loading inside the gesture lets browsers that only
      // allow media started by one (iOS Safari) play these elements later from the clock; if one still refuses, the
      // excerpt goes on silent (cue).
      audios.current = timeline.lines.map((_, i) => {
        const a = new Audio();
        a.preload = "auto";
        a.addEventListener("error", silence);
        a.src = audioSrc(locale, i);
        return a;
      });
    }
    soundRef.current = true;
    setSound(true);
    // Turning the sound on means "let me hear it": from the start if it had ended or never ran.
    if (tRef.current >= timeline.end) seek(0);
    if (!playingRef.current) run(true);
    // Before the first line, start it now, inside the click.
    if (tRef.current < timeline.lines[0].start) {
      seek(timeline.lines[0].start);
      cue(0);
    }
  }, [timeline, locale, silence, seek, run, cue]);

  // Reduced motion: the finished state, nothing plays by itself.
  useEffect(() => {
    if (reduce) finish();
  }, [reduce, finish]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      let next = tRef.current + dt;
      const list = audios.current;
      if (soundRef.current && list) {
        const i = lineAt(timeline, tRef.current);
        const l = i >= 0 ? timeline.lines[i] : null;
        if (l && tRef.current < l.start + l.seconds) {
          const a = list[i];
          if (current.current !== i) cue(i);
          if (a.readyState < HAVE_FUTURE_DATA && !a.ended) {
            holdSince.current ??= now;
            if (now - holdSince.current > AUDIO_PATIENCE_MS) {
              silence();
            } else {
              setLoading(true);
              next = tRef.current; // hold the clock until the line can play
            }
          } else {
            holdSince.current = null;
            setLoading(false);
            if (!a.paused && !a.ended) next = l.start + a.currentTime;
          }
        }
      }
      if (next >= timeline.end) {
        seek(timeline.end);
        run(false);
        stopAudio();
        return;
      }
      seek(next);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, timeline, cue, silence, seek, run, stopAudio]);

  // Off screen or in a hidden tab: pause, and pick up again on return.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let onScreen = false;
    const sync = () => {
      const can = onScreen && document.visibilityState === "visible";
      if (!can && playingRef.current) {
        resume.current = true;
        run(false);
        stopAudio();
      } else if (can && resume.current) {
        resume.current = false;
        run(true);
      }
    };
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [stage, run, stopAudio]);

  // Never leave sound playing behind an unmounted section (a language switch remounts it).
  useEffect(
    () => () => {
      audios.current?.forEach((a) => {
        a.removeEventListener("error", silence);
        a.pause();
      });
    },
    [silence],
  );

  return { t, index: lineAt(timeline, t), started, ended: t >= timeline.end, playing, sound, loading, play, pause, replay, toggleSound, finish };
}
