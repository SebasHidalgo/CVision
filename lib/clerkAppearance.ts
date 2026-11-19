import { fontText } from "@/components/design-system/fonts";
import { ED_COLOR as ED, ED_RADIUS } from "@/components/design-system/tokens";

/**
 * Clerk's components (sign-in and sign-up modals, the profile) in the dark design, once for the whole app: the
 * root layout's ClerkProvider applies it. Clerk derives shades from its colour variables, so they take literal
 * values: the design system's tokens.ts, which a test keeps equal to tokens.css. The modals portal into <body>,
 * outside any design root: the text face goes by its family name (its @font-face loads with this module), and
 * Fraunces by the variable the root layout puts on <body>.
 */

const FOCUS = { outline: `2px solid ${ED.ink}`, outlineOffset: "2px" };

// Clerk draws an input's edge as a 1 px shadow in its border colour at 11 % (28 % on hover): 1.03:1 on the
// card. These replace it at the same selector, so they win by order, with the field token's edge, an ink ring
// on focus, and the danger text colour on a field with an error.
const edge = (color: string) => `0 0 0 1px ${color}`;
const FIELD_EDGE = {
  boxShadow: edge(ED.field),
  "&:hover": { boxShadow: edge(ED.ink2) },
  '&:focus-within,&[data-focus-within="true"]': { boxShadow: `0 0 0 2px ${ED.ink}` },
  '&[data-feedback="error"]': {
    boxShadow: edge(ED.dangerText),
    "&:hover": { boxShadow: edge(ED.dangerText) },
    '&:focus-within,&[data-focus-within="true"]': { boxShadow: `0 0 0 2px ${ED.dangerText}` },
  },
};

export const clerkAppearance = {
  variables: {
    colorPrimary: ED.ink,
    colorPrimaryForeground: ED.bg,
    colorDanger: ED.dangerText,
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
    borderRadius: ED_RADIUS.field,
  },
  elements: {
    // A compound value needs no derivation: the variable itself, as tokens.css emits it on :root.
    cardBox: { border: `1px solid ${ED.line2}`, borderRadius: ED_RADIUS.surface, boxShadow: "var(--shadow-ed-surface)" },
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
    // Every input Clerk draws in its default variant: the sign-in fields, the profile's forms.
    input: { '&[data-variant="default"]': FIELD_EDGE },
    formFieldInput: { minHeight: "44px" },
    button: {
      "&:focus-visible": FOCUS,
      // A filled danger button (the profile's "Remove" forms) puts white on the danger colour: 2.5:1. Page ink reads.
      '&[data-variant="solid"][data-color="danger"]': { color: ED.bg },
    },
    formFieldInputShowPasswordButton: { "&:focus-visible": FOCUS },
    footerActionLink: { "&:focus-visible": FOCUS },
    // Black marks would vanish on the dark card.
    socialButtonsProviderIcon__github: { filter: "invert(1)" },
    socialButtonsProviderIcon__apple: { filter: "invert(1)" },
  },
};
