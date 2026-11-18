"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/design-system/Logo";
import { BRAND } from "@/lib/brand";

const LEGAL = [
  { href: "/privacy", key: "footer.privacy" },
  { href: "/terms", key: "footer.terms" },
  { href: "/refunds", key: "footer.refunds" },
] as const;

/** The landing's footer: what the product is, and the legal pages. */
export function LandingFooter() {
  const { t } = useTranslation("landing");
  return (
    <footer className="ed-chrome relative z-[1] mt-[clamp(80px,10vw,144px)] border-t border-ed-line-2 bg-ed-bg pt-8 pb-10">
      <div className="ed-wrap ed-grid items-start gap-y-[18px]">
        <div className="grid max-w-[46ch] gap-2.5 text-[14px] text-ed-ink-3 lg:col-span-5">
          <Logo />
          <p>{t("footer.about")}</p>
        </div>
        <nav aria-label={t("footer.legalLabel")} className="flex flex-wrap gap-x-[22px] text-[14.5px] text-ed-ink-2 lg:col-start-7 lg:col-end-10">
          {LEGAL.map((page) => (
            <Link key={page.href} href={page.href} className="inline-flex min-h-11 items-center no-underline hover:text-ed-ink hover:underline hover:underline-offset-4">
              {t(page.key)}
            </Link>
          ))}
        </nav>
        <p className="ed-mono self-center text-[13px] text-ed-ink-3 lg:col-start-10 lg:col-end-13 lg:text-right">
          © {new Date().getUTCFullYear()} {BRAND.name}
        </p>
      </div>
    </footer>
  );
}
