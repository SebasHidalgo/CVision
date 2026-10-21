"use client";

import { useClerk } from "@clerk/nextjs";
import { Slot } from "@radix-ui/react-slot";
import { useClerkAppearance } from "@/hooks/useClerkAppearance";

type SignInCtaProps = {
  /** Where Clerk sends the user after the modal succeeds. */
  forceRedirectUrl?: string;
  /** Which modal opens first; either lets the visitor switch to the other. */
  mode?: "signIn" | "signUp";
  /** One clickable element; the open handler is merged onto it. */
  children: React.ReactElement;
};

/**
 * Sign-in (or sign-up) modal trigger that carries the current theme into
 * Clerk's UI. Opens imperatively: <SignInButton> spreads unknown props such
 * as `appearance` onto its child, which leaks into the DOM and breaks
 * hydration.
 */
export default function SignInCta({ forceRedirectUrl, mode = "signIn", children }: SignInCtaProps) {
  const { openSignIn, openSignUp } = useClerk();
  const appearance = useClerkAppearance();
  const open = mode === "signUp" ? openSignUp : openSignIn;

  return (
    <Slot onClick={() => open({ appearance, forceRedirectUrl })}>
      {children}
    </Slot>
  );
}
