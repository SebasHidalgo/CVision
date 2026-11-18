"use client";

import { useClerk } from "@clerk/nextjs";
import { Slot } from "@radix-ui/react-slot";

type SignInCtaProps = {
  /** Where Clerk sends the user after the modal succeeds. */
  forceRedirectUrl?: string;
  /** Which modal opens first; either lets the visitor switch to the other. */
  mode?: "signIn" | "signUp";
  /** One clickable element; the open handler is merged onto it. */
  children: React.ReactElement;
};

/**
 * Sign-in (or sign-up) modal trigger. Opens imperatively: <SignInButton>
 * spreads unknown props onto its child, which leaks into the DOM and breaks
 * hydration. The modal's look comes from the root layout's ClerkProvider.
 */
export default function SignInCta({ forceRedirectUrl, mode = "signIn", children }: SignInCtaProps) {
  const { openSignIn, openSignUp } = useClerk();
  const open = mode === "signUp" ? openSignUp : openSignIn;

  return (
    <Slot onClick={() => open({ forceRedirectUrl })}>
      {children}
    </Slot>
  );
}
