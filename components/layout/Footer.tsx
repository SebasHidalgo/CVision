import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import SignInCta from "@/components/auth/SignInCta";
import Wordmark from "@/components/brand/Wordmark";

const LEGAL = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
];

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="wrap flex flex-col gap-8 py-10 md:flex-row md:items-end md:justify-between">
        <div>
          <Wordmark />
          <p className="eyebrow mt-3">
            Set in Fraunces, Schibsted Grotesk and IBM Plex Mono.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <Link href="/#how" className="link-rule text-ink-2">
            How it works
          </Link>
          <Link href="/pricing" className="link-rule text-ink-2">
            Pricing
          </Link>
          <SignedIn>
            <Link href="/resume/analyses" className="link-rule text-ink-2">
              Analyses
            </Link>
            <Link href="/interviews" className="link-rule text-ink-2">
              Interviews
            </Link>
            <Link href="/account/billing" className="link-rule text-ink-2">
              Plan &amp; billing
            </Link>
          </SignedIn>
          <SignedOut>
            <SignInCta>
              <button type="button" className="link-rule cursor-pointer text-ink-2">
                Sign in
              </button>
            </SignInCta>
          </SignedOut>
          {LEGAL.map((page) => (
            <Link key={page.href} href={page.href} className="link-rule text-ink-2">
              {page.label}
            </Link>
          ))}
          <span className="eyebrow self-center">© 2026 CVision</span>
        </nav>
      </div>
    </footer>
  );
}
