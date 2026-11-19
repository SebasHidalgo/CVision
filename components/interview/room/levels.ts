/** A voice level (0 to 1) as the meter draws it: speech sits low on a linear scale, so the curve lifts it. */
export function meterValue(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(1, Math.sqrt(level) * 1.6);
}

const TAU = Math.PI * 2;

/**
 * A level that moves like speech (syllables inside words), for rooms that play a script instead of a call: the
 * landing's replica and the dev preview. Deterministic in time; `seed` keeps two voices apart.
 */
export function speechLevel(ms: number, seed = 0): number {
  const s = ms / 1000;
  const syllables = 0.5 + 0.5 * Math.sin(TAU * 4.3 * s + seed);
  const words = 0.5 + 0.5 * Math.sin(TAU * 1.1 * s + seed * 1.7);
  const grain = 0.5 + 0.5 * Math.sin(TAU * 9.7 * s + seed * 3.1);
  return Math.min(1, Math.max(0, 0.04 + 0.32 * syllables * (0.35 + 0.65 * words) + 0.06 * grain));
}
