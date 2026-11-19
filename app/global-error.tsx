"use client";

import "./globals.css";
import { fontText } from "@/components/design-system/fonts";
import GlobalErrorScreen from "@/screens/Error/GlobalErrorScreen";

// The root layout failed: this replaces the whole document, with no providers and no locale, so it carries its own
// styles and font and speaks both languages.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className={`root ${fontText.variable} flex min-h-dvh flex-col`}>
        <GlobalErrorScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
