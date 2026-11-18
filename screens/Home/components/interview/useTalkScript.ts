"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Locale } from "@/lib/i18n/config";
import { timelineFor, type TimedLine, type Timeline } from "./talk";

export type SpokenLine = TimedLine & { readonly text: string };
/** A timeline whose lines carry their words. */
export type Script = { readonly lines: readonly SpokenLine[]; readonly end: Timeline["end"] };

/** The excerpt's timeline with its words in the reader's language. */
export function useTalkScript(locale: Locale): Script {
  const { t } = useTranslation("landingInterview");
  return useMemo(() => {
    const timeline = timelineFor(locale);
    return { end: timeline.end, lines: timeline.lines.map((l) => ({ ...l, text: t(`talk.lines.${l.id}`) })) };
  }, [t, locale]);
}
