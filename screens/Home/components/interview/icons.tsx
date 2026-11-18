// The excerpt's control icons: filled, 18 px, in the text colour. Decorative: every control has its words.

export type ControlIconName = "play" | "pause" | "replay" | "sound" | "mute";

const PATHS: Record<ControlIconName, string> = {
  play: "M8 5.5v13l10.5-6.5z",
  pause: "M7.5 5.5h3v13h-3zm6 0h3v13h-3z",
  replay: "M12 5a7 7 0 1 1-6.7 9h2.1A5 5 0 1 0 12 7v3L7.5 6 12 2z",
  sound: "M4 9.5h3.5L12 5.5v13l-4.5-4H4zm11.5-1.8a6 6 0 0 1 0 8.6l-1.2-1.2a4.3 4.3 0 0 0 0-6.2zm2.6-2.6a9.6 9.6 0 0 1 0 13.8l-1.2-1.2a7.9 7.9 0 0 0 0-11.4z",
  mute: "M4 9.5h3.5L12 5.5v13l-4.5-4H4zm11.3.2 1.2-1.2 2 2 2-2 1.2 1.2-2 2 2 2-1.2 1.2-2-2-2 2-1.2-1.2 2-2z",
};

export function ControlIcon({ name }: { name: ControlIconName }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden focusable="false" className="flex-none">
      <path d={PATHS[name]} fill="currentColor" />
    </svg>
  );
}
