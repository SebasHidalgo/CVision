"use client";

import { usePathname } from "next/navigation";

// The interview room fills the viewport under the header: a footer there would make a live call's page scroll.
const FILLS_VIEWPORT = [/^\/interview\/[^/]+\/?$/, /^\/dev\/room-preview\/?$/];

/** Renders the footer everywhere except under the interview room. */
export default function FooterGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return FILLS_VIEWPORT.some((route) => route.test(pathname)) ? null : <>{children}</>;
}
