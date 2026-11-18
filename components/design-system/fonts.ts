import { Host_Grotesk } from "next/font/google";

// The text face of the design system. Fraunces and Plex Mono load in the root layout (every page uses them);
// this one loads only on the pages already migrated, which put `fontText.variable` on their root.
export const fontText = Host_Grotesk({
  subsets: ["latin"],
  variable: "--font-host-grotesk",
  display: "swap",
});
