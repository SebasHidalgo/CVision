// Motion tokens for scripts (WAAPI, framer, timers); tokens.css holds the same values for CSS.

export const EASE = {
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  settle: "cubic-bezier(0.22, 0.8, 0.24, 1)",
  story: "cubic-bezier(0.2, 0.75, 0.1, 1)",
} as const;

/** Milliseconds. */
export const DURATION = {
  quick: 200,
  base: 380,
  slow: 600,
} as const;
