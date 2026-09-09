"use client";

import { useClerk } from "@clerk/nextjs";
import { Slot } from "@radix-ui/react-slot";
import { useClerkAppearance } from "@/hooks/useClerkAppearance";

type SignInCtaProps = {
  /** Where Clerk sends the user after the modal succeeds. */
  forceRedirectUrl?: string;
  /** One clickable element; the open handler is merged onto it. */
  children: React.ReactElement;
};

/**
 * Sign-in modal trigger that carries the current theme into Clerk's UI.
 * Opens imperatively: <SignInButton> spreads unknown props such as
 * `appearance` onto its child, which leaks into the DOM and breaks hydration.
 */
export default function SignInCta({ forceRedirectUrl, children }: SignInCtaProps) {
  const { openSignIn } = useClerk();
  const appearance = useClerkAppearance();

  return (
    <Slot onClick={() => openSignIn({ appearance, forceRedirectUrl })}>
      {children}
    </Slot>
  );
}
