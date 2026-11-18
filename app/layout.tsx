import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import I18nProvider from "@/components/providers/I18nProvider";
import Providers from "@/components/providers/Providers";
import { BOOT_SCRIPT } from "@/lib/bootScript";
import { appUrl, BRAND } from "@/lib/brand";
import { clerkAppearance } from "@/lib/clerkAppearance";
import { clerkLocalization } from "@/lib/clerkLocalization";
import { GLOBAL_CLIENT_NAMESPACES } from "@/lib/i18n/config";
import { pickResources } from "@/lib/i18n/resources";
import { getLocale, getT } from "@/lib/i18n/server";

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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("common");
  return {
    metadataBase: new URL(appUrl()),
    title: {
      default: BRAND.name,
      template: `%s · ${BRAND.name}`,
    },
    description: t("meta.description"),
    applicationName: BRAND.name,
  };
}

// One design, no dark mode: the paper. A page on another ground exports its own themeColor.
export const viewport: Viewport = {
  themeColor: "#f8f6f2",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    // One appearance for everything Clerk renders, its modals included.
    // No telemetry: a development instance would send it to a host the CSP blocks (lib/securityHeaders.ts).
    <ClerkProvider appearance={clerkAppearance} localization={clerkLocalization(locale)} telemetry={false}>
      {/* BOOT_SCRIPT adds data-js (and, on the landing, data-loading) to <html> before hydration. */}
      <html lang={locale} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        </head>
        <body
          className={`${fraunces.variable} ${schibsted.variable} ${plexMono.variable} flex min-h-dvh flex-col`}
        >
          {/* Not keyed by locale: a language switch keeps the client tree (and its form state). */}
          <I18nProvider locale={locale} resources={pickResources(locale, GLOBAL_CLIENT_NAMESPACES)}>
            <Providers>{children}</Providers>
          </I18nProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
