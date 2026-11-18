// The landing's readiness signals: each part reports once, the loader fills one mark per signal.

export const READY_SIGNALS = ["fonts", "hero-data", "scene-chunk", "scene-frame", "silk-frame", "images"] as const;
export type ReadySignal = (typeof READY_SIGNALS)[number];

const EVENT = "cvision:ready";

declare global {
  interface Window {
    __cvReady?: Set<ReadySignal>;
  }
}

function store(): Set<ReadySignal> | null {
  if (typeof window === "undefined") return null;
  window.__cvReady ??= new Set();
  return window.__cvReady;
}

/** Reports one signal; repeats are ignored. */
export function markReady(signal: ReadySignal) {
  const seen = store();
  if (!seen || seen.has(signal)) return;
  seen.add(signal);
  window.dispatchEvent(new CustomEvent<ReadySignal>(EVENT, { detail: signal }));
}

/** The signals reported so far. */
export function readySignals(): ReadySignal[] {
  return [...(store() ?? [])];
}

/** Calls back for every signal, past ones included; returns the unsubscribe. */
export function onReady(callback: (signal: ReadySignal) => void): () => void {
  if (typeof window === "undefined") return () => {};
  for (const signal of readySignals()) callback(signal);
  const listener = (e: Event) => callback((e as CustomEvent<ReadySignal>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
