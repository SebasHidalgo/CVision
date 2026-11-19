"use client";

import SignInCta from "@/components/auth/SignInCta";
import { buttonClass } from "@/components/design-system/Button";

type SignUpButtonProps = {
  label: string;
  /** Where Clerk sends the new account: the upload page for Free, the pricing page (and its checkout) for Pro. */
  redirect: "/resume/upload" | "/pricing";
  variant?: "solid" | "ghost";
  className?: string;
};

/** Clerk's sign-up as a pill. The button is created here, on the client (CLAUDE.md debt 32). */
export function SignUpButton({ label, redirect, variant, className }: SignUpButtonProps) {
  return (
    <SignInCta mode="signUp" forceRedirectUrl={redirect}>
      <button type="button" className={buttonClass({ variant, className })}>
        {label}
      </button>
    </SignInCta>
  );
}
