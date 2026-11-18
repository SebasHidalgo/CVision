import { fontText } from "@/components/design-system/fonts";

/**
 * Clerk's components (sign-in and sign-up modals, the profile) in the dark design, once for the whole app: the
 * root layout's ClerkProvider applies it. Clerk derives shades from its colour variables, so they take literal
 * values: these are the tokens of components/design-system/tokens.css, kept in step by hand. The modals portal
 * into <body>, outside any design root: the text face goes by its family name (its @font-face loads with this
 * module), and Fraunces by the variable the root layout puts on <body>.
 */
const ED = {
  bg: "#0c0d0f",
  panel: "#121316",
  raise: "#17181c",
  line2: "#34363c",
  ink: "#ededea",
  ink2: "#a3a6ad",
  signal: "#3edc8a",
} as const;

// tokens.css has no danger colour for text: ed-danger (#b4382a) is 3.1:1 on the panel. This coral is 6.8:1 there,
// and Clerk's danger buttons put the dark primary foreground on it (7.1:1).
const DANGER_TEXT = "#f0796a";

const SURFACE_SHADOW = "0 1px 0 rgb(0 0 0 / 0.6), 0 8px 12px -8px rgb(0 0 0 / 0.7)";
const FOCUS = { outline: `2px solid ${ED.ink}`, outlineOffset: "2px" };

export const clerkAppearance = {
  variables: {
    colorPrimary: ED.ink,
    colorPrimaryForeground: ED.bg,
    colorDanger: DANGER_TEXT,
    colorSuccess: ED.signal,
    colorNeutral: ED.ink,
    colorForeground: ED.ink,
    colorMutedForeground: ED.ink2,
    colorMuted: ED.raise,
    colorBackground: ED.panel,
    colorInput: ED.bg,
    colorInputForeground: ED.ink,
    colorBorder: ED.line2,
    colorRing: ED.ink,
    colorShadow: "#000000",
    colorModalBackdrop: ED.bg,
    fontFamily: fontText.style.fontFamily,
    fontFamilyButtons: fontText.style.fontFamily,
    fontSize: "0.9375rem",
    borderRadius: "6px",
  },
  elements: {
    cardBox: { border: `1px solid ${ED.line2}`, borderRadius: "10px", boxShadow: SURFACE_SHADOW },
    headerTitle: {
      fontFamily: "var(--font-fraunces), Georgia, 'Times New Roman', serif",
      fontWeight: 300,
      fontSize: "1.75rem",
      letterSpacing: "-0.02em",
      fontVariationSettings: "'opsz' 144, 'SOFT' 0, 'WONK' 0",
    },
    headerSubtitle: { color: ED.ink2 },
    // Pills, as every button of the design.
    formButtonPrimary: { borderRadius: "9999px", fontWeight: 600, minHeight: "44px", textTransform: "none" },
    socialButtonsBlockButton: { borderRadius: "9999px", minHeight: "44px" },
    formFieldInput: { minHeight: "44px" },
    button: { "&:focus-visible": FOCUS },
    formFieldInputShowPasswordButton: { "&:focus-visible": FOCUS },
    footerActionLink: { "&:focus-visible": FOCUS },
    // Black marks would vanish on the dark card.
    socialButtonsProviderIcon__github: { filter: "invert(1)" },
    socialButtonsProviderIcon__apple: { filter: "invert(1)" },
  },
};
