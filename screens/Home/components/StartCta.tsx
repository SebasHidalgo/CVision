"use client";

import { SignedIn, SignedOut } from "@clerk/nextjs";
import SignInCta from "@/components/auth/SignInCta";
import { buttonClass, ButtonLink } from "@/components/design-system/Button";

type StartCtaProps = {
  /** Signed out: opens Clerk's sign-up, then the upload page. */
  label: string;
  /** Signed in: a link to the upload page. */
  signedInLabel: string;
  variant?: "solid" | "ghost";
  size?: "md" | "sm";
  className?: string;
};

/** The landing's start action. The button is created here, on the client (CLAUDE.md debt 32). */
export function StartCta({ label, signedInLabel, variant, size, className }: StartCtaProps) {
  return (
    <>
      <SignedOut>
        <SignInCta mode="signUp" forceRedirectUrl="/resume/upload">
          <button type="button" className={buttonClass({ variant, size, className })}>
            {label}
          </button>
        </SignInCta>
      </SignedOut>
      <SignedIn>
        <ButtonLink href="/resume/upload" variant={variant} size={size} className={className}>
          {signedInLabel}
        </ButtonLink>
      </SignedIn>
    </>
  );
}
