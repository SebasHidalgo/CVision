/**
 * Clerk's modals render in-page but take colors as literal values, so the
 * paper and ink tokens are restated here per theme. Keep in step with the
 * `:root` and `.dark` blocks in globals.css.
 */
export type ThemeName = "light" | "dark";

const shared = {
  borderRadius: "3px",
  fontFamily: "var(--font-schibsted), ui-sans-serif, system-ui, sans-serif",
};

const variables: Record<ThemeName, Record<string, string>> = {
  light: {
    ...shared,
    colorPrimary: "#1d2030",
    colorBackground: "#f8f6f2",
    colorText: "#1d2030",
    colorTextSecondary: "#5a5e6b",
    colorInputBackground: "#f8f6f2",
    colorInputText: "#1d2030",
    colorNeutral: "#1d2030",
    colorDanger: "#d9532f",
  },
  dark: {
    ...shared,
    colorPrimary: "#ece8e1",
    colorTextOnPrimaryBackground: "#1f1c19",
    colorBackground: "#2c2925",
    colorText: "#ece8e1",
    colorTextSecondary: "#b7b1a8",
    colorInputBackground: "#262320",
    colorInputText: "#ece8e1",
    colorNeutral: "#ece8e1",
    colorDanger: "#ea7455",
  },
};

export function clerkAppearance(theme: ThemeName) {
  return { variables: variables[theme] };
}
