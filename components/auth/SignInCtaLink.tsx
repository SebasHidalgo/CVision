"use client";

import SignInCta from "./SignInCta";

type SignInCtaLinkProps = {
  className?: string;
  /** Text only, for the reason SignInCtaButton gives. */
  children: string;
};

/** A sign-in trigger styled as a link, rendered on the client: a server-rendered element under SignInCta's Slot fails hydration. */
export default function SignInCtaLink({ className, children }: SignInCtaLinkProps) {
  return (
    <SignInCta>
      <button type="button" className={className}>
        {children}
      </button>
    </SignInCta>
  );
}
