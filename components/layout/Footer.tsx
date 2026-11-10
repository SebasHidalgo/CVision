import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import SignInCta from "@/components/auth/SignInCta";
import Wordmark from "@/components/brand/Wordmark";
import { BRAND } from "@/lib/brand";
import { getT } from "@/lib/i18n/server";

const LEGAL = [
  { href: "/terms", labelKey: "footer.terms" },
  { href: "/privacy", labelKey: "footer.privacy" },
  { href: "/refunds", labelKey: "footer.refunds" },
] as const;

export async function Footer() {
  const t = await getT("common");
  return (
    <footer className="border-t border-line">
      <div className="wrap flex flex-col gap-8 py-10 md:flex-row md:items-end md:justify-between">
        <div>
          <Wordmark />
          <p className="eyebrow mt-3">{t("footer.typeset")}</p>
        </div>

        <nav aria-label={t("footer.label")} className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <Link href="/#how" className="link-rule text-ink-2">
            {t("footer.howItWorks")}
          </Link>
          <Link href="/pricing" className="link-rule text-ink-2">
            {t("nav.pricing")}
          </Link>
          <SignedIn>
            <Link href="/resume/analyses" className="link-rule text-ink-2">
              {t("nav.analyses")}
            </Link>
            <Link href="/interviews" className="link-rule text-ink-2">
              {t("nav.interviews")}
            </Link>
            <Link href="/account/billing" className="link-rule text-ink-2">
              {t("nav.planBilling")}
            </Link>
          </SignedIn>
          <SignedOut>
            <SignInCta>
              <button type="button" className="link-rule cursor-pointer text-ink-2">
                {t("nav.signIn")}
              </button>
            </SignInCta>
          </SignedOut>
          {LEGAL.map((page) => (
            <Link key={page.href} href={page.href} className="link-rule text-ink-2">
              {t(page.labelKey)}
            </Link>
          ))}
          <span className="eyebrow self-center">© {new Date().getUTCFullYear()} {BRAND.name}</span>
        </nav>
      </div>
    </footer>
  );
}
