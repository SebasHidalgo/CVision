import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import SignInCta from "@/components/auth/SignInCta";
import Wordmark from "@/components/brand/Wordmark";

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
          <a href="#how" className="link-rule text-ink-2">
            How it works
          </a>
          <SignedIn>
            <Link href="/resume/analyses" className="link-rule text-ink-2">
              Analyses
            </Link>
            <Link href="/interviews" className="link-rule text-ink-2">
              Interviews
            </Link>
          </SignedIn>
          <SignedOut>
            <SignInCta>
              <button type="button" className="link-rule cursor-pointer text-ink-2">
                Sign in
              </button>
            </SignInCta>
          </SignedOut>
          <span className="eyebrow self-center">© 2026 CVision</span>
        </nav>
      </div>
    </footer>
  );
}
