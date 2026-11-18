import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import I18nProvider from "@/components/providers/I18nProvider";
import Providers from "@/components/providers/Providers";
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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#262320" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Runs before first paint: CSS that hides content for an entrance applies only under html[data-js],
// so a page without JavaScript is never hidden.
const MARK_JS = `document.documentElement.dataset.js=""`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    // Base appearance for anything Clerk renders without an explicit one;
    // modals opened from the client pass the themed variant themselves.
    // No telemetry: a development instance would send it to a host the CSP blocks (lib/securityHeaders.ts).
    <ClerkProvider appearance={clerkAppearance("light")} localization={clerkLocalization(locale)} telemetry={false}>
      {/* next-themes' class and MARK_JS's data-js change <html> before hydration. */}
      <html lang={locale} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: MARK_JS }} />
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
