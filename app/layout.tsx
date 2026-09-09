import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Header } from "@/components/navbar/Header";
import Providers from "@/components/providers/Providers";
import { clerkAppearance } from "@/lib/clerkAppearance";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
  display: "swap",
});

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CVision",
    template: "%s · CVision",
  },
  description:
    "Paste a job post, upload your CV, and find out how well you actually fit before you apply. Then rehearse the interview out loud.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#262320" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Base appearance for anything Clerk renders without an explicit one;
    // modals opened from the client pass the themed variant themselves.
    <ClerkProvider appearance={clerkAppearance("light")}>
      {/* next-themes sets the class on <html> before hydration. */}
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${fraunces.variable} ${schibsted.variable} ${plexMono.variable} flex min-h-dvh flex-col`}
        >
          <Providers>
            <Header />
            <main className="flex flex-1 flex-col">{children}</main>
          </Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
