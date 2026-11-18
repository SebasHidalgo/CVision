"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ControlIcon } from "./icons";
import type { TalkState } from "./talk";

const PILL = cn(
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-ed-line-2 bg-ed-raise pr-4 pl-3 text-[14.5px] text-ed-ink",
  "transition-[border-color,background-color] duration-200 hover:border-ed-ink-2 motion-reduce:transition-none",
);

/**
 * Play, start over and the sound toggle, with the honesty line about the voices. The sound is off until the reader
 * turns it on; the toggle keeps one name and says its state with aria-pressed.
 */
export function TalkControls({ talk, className }: { talk: TalkState; className?: string }) {
  const { t } = useTranslation("landingInterview");
  const midway = talk.started && talk.t > 0 && !talk.ended;
  const main = talk.playing ? t("controls.pause") : talk.ended ? t("controls.again") : midway ? t("controls.resume") : t("controls.play");

  return (
    <div className={cn("grid gap-2.5", className)}>
      <div role="group" aria-label={t("controls.group")} className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={talk.playing ? talk.pause : talk.ended ? talk.replay : talk.play}
          className={cn(PILL, "border-ed-ink bg-ed-ink text-ed-bg hover:border-white hover:bg-white")}
        >
          <ControlIcon name={talk.playing ? "pause" : "play"} />
          {main}
        </button>
        {/* Shown from the first play, also at 0:00 after a restart, so the button never vanishes under the click. */}
        {talk.started && !talk.ended && (
          <button type="button" onClick={talk.replay} className={PILL}>
            <ControlIcon name="replay" />
            {t("controls.restart")}
          </button>
        )}
        <button
          type="button"
          aria-pressed={talk.sound}
          onClick={talk.toggleSound}
          className={cn(PILL, "aria-pressed:border-ed-ink aria-pressed:bg-ed-line")}
        >
          <ControlIcon name={talk.sound ? "sound" : "mute"} />
          {t("controls.sound")}
        </button>
        <span role="status" className="text-[13px] text-ed-ink-2">
          {talk.sound && talk.loading ? t("controls.loading") : null}
        </span>
      </div>
      <p className="max-w-[46ch] text-[13px] leading-[1.45] text-ed-ink-2">
        <span className="block font-ed-mono text-[12px] tracking-[0.02em] text-ed-ink">{t("controls.voiceLabel")}</span>{" "}
        {t("controls.voiceNote")}
      </p>
    </div>
  );
}
