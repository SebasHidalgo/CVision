import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Header } from "@/components/navbar/Header";
import Providers from "@/components/providers/Providers";

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
  themeColor: "#f8f6f2",
  width: "device-width",
  initialScale: 1,
};

// Clerk renders in-page, so its modals pick up the same paper and ink.
const clerkAppearance = {
  variables: {
    colorPrimary: "#1d2030",
    colorBackground: "#f8f6f2",
    colorText: "#1d2030",
    colorTextSecondary: "#5a5e6b",
    colorInputBackground: "#f8f6f2",
    colorInputText: "#1d2030",
    colorDanger: "#d9532f",
    borderRadius: "3px",
    fontFamily: "var(--font-schibsted), ui-sans-serif, system-ui, sans-serif",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en">
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
