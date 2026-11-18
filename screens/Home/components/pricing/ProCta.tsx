"use client";

import { SignedIn, SignedOut } from "@clerk/nextjs";
import SignInCta from "@/components/auth/SignInCta";
import { buttonClass, ButtonLink } from "@/components/design-system/Button";

type ProCtaProps = {
  /** Signed out: opens Clerk's sign-up, then the pricing page, whose button opens the real checkout. */
  label: string;
  /** Signed in: a link to the pricing page (checkout for Free, the portal for Pro). */
  signedInLabel: string;
  variant?: "solid" | "ghost";
  size?: "md" | "sm";
  className?: string;
};

/** Pro's action, as the pricing page starts it. The button is created here, on the client (CLAUDE.md debt 32). */
export function ProCta({ label, signedInLabel, variant, size, className }: ProCtaProps) {
  return (
    <>
      <SignedOut>
        <SignInCta mode="signUp" forceRedirectUrl="/pricing">
          <button type="button" className={buttonClass({ variant, size, className })}>
            {label}
          </button>
        </SignInCta>
      </SignedOut>
      <SignedIn>
        <ButtonLink href="/pricing" variant={variant} size={size} className={className}>
          {signedInLabel}
        </ButtonLink>
      </SignedIn>
    </>
  );
}
