import Link from "next/link";
import { fontText } from "@/components/design-system/fonts";
import { Logo } from "@/components/design-system/Logo";
import { BRAND } from "@/lib/brand";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import FooterGate from "./FooterGate";

const PRODUCT = [
  { href: "/#how-it-works", labelKey: "nav.howItWorks" },
  { href: "/pricing", labelKey: "nav.pricing" },
] as const;

const LEGAL = [
  { href: "/terms", labelKey: "footer.terms" },
  { href: "/privacy", labelKey: "footer.privacy" },
  { href: "/refunds", labelKey: "footer.refunds" },
] as const;

const LINK =
  "inline-flex min-h-11 max-w-full items-center text-ed-small text-ed-ink-2 no-underline transition-colors duration-200 hover:text-ed-ink hover:underline hover:underline-offset-4";

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="ed-cap mb-1">{label}</p>
      <ul>{children}</ul>
    </div>
  );
}

/**
 * The one footer, on every page but the interview room: what the product is, its pages, the legal drafts and
 * where to write. Dark chrome with its own design root, like the header, so it reads the same under a light page.
 */
export async function Footer({ className }: { className?: string }) {
  const t = await getT("common");
  return (
    <FooterGate>
      <footer className={cn("ed-root ed-chrome relative z-[1] border-t border-ed-line-2 bg-ed-bg", fontText.variable, className)}>
        <div className="ed-wrap ed-grid gap-y-8 pt-10 pb-8 lg:pt-12">
          <div className="grid content-start gap-2 lg:col-span-5">
            <Link href="/" aria-label={t("nav.home")} className="inline-flex min-h-11 w-fit items-center no-underline">
              <Logo />
            </Link>
            <p className="max-w-[46ch] text-ed-small text-ed-ink-2">{t("footer.about")}</p>
          </div>

          <nav aria-label={t("footer.label")} className="grid grid-cols-2 gap-x-ed-gutter gap-y-6 sm:grid-cols-3 lg:col-start-7 lg:col-end-13">
            <Group label={t("footer.product")}>
              {PRODUCT.map((page) => (
                <li key={page.href}>
                  <Link href={page.href} className={LINK}>
                    {t(page.labelKey)}
                  </Link>
                </li>
              ))}
            </Group>
            <Group label={t("footer.legal")}>
              {LEGAL.map((page) => (
                <li key={page.href}>
                  <Link href={page.href} className={LINK}>
                    {t(page.labelKey)}
                  </Link>
                </li>
              ))}
            </Group>
            <Group label={t("footer.support")}>
              <li>
                <a href={`mailto:${BRAND.supportEmail}`} className={cn(LINK, "[overflow-wrap:anywhere]")}>
                  {BRAND.supportEmail}
                </a>
              </li>
            </Group>
          </nav>

          <p className="ed-mono border-t border-ed-line pt-6 text-ed-micro text-ed-ink-3">
            © {new Date().getUTCFullYear()} {BRAND.name}
          </p>
        </div>
      </footer>
    </FooterGate>
  );
}
