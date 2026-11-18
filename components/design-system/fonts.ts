import { Host_Grotesk } from "next/font/google";

// The text face of the design system. Fraunces and Plex Mono load in the root layout; this one loads with the
// header and Clerk's appearance (every page), and a migrated page puts `fontText.variable` on its root.
export const fontText = Host_Grotesk({
  subsets: ["latin"],
  variable: "--font-host-grotesk",
  display: "swap",
});
