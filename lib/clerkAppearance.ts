/**
 * Clerk's components (modals included) render in-page but take colors as
 * literal values, so the paper and ink tokens are restated here. Keep in
 * step with the `:root` block in globals.css. The root layout's
 * ClerkProvider applies it to everything Clerk renders.
 */
export const clerkAppearance = {
  variables: {
    borderRadius: "3px",
    fontFamily: "var(--font-schibsted), ui-sans-serif, system-ui, sans-serif",
    colorPrimary: "#1d2030",
    colorBackground: "#f8f6f2",
    colorText: "#1d2030",
    colorTextSecondary: "#5a5e6b",
    colorInputBackground: "#f8f6f2",
    colorInputText: "#1d2030",
    colorNeutral: "#1d2030",
    colorDanger: "#d9532f",
  },
};
