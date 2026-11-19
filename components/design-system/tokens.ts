/**
 * tokens.css's values as literals, for code that cannot read a CSS variable: Clerk derives its shades from literal
 * colours. tokens.css decides every value; tokens.test.ts fails when a literal here drifts from it.
 */
export const ED_COLOR = {
  bg: "#0c0d0f",
  panel: "#121316",
  raise: "#17181c",
  sheet: "#131417",
  line: "#24262b",
  line2: "#34363c",
  field: "#6b6e75",
  ink: "#ededea",
  ink2: "#a3a6ad",
  signal: "#3edc8a",
  signalWash: "rgb(62 220 138 / 0.08)",
  danger: "#b4382a",
  dangerHover: "#a03024",
  dangerEdge: "#c44332",
  dangerText: "#ff7f71",
} as const;

export const ED_RADIUS = {
  surface: "10px",
  field: "6px",
  kbd: "5px",
} as const;
