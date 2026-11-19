"use client";

import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ButtonLink } from "@/components/design-system/Button";
import { SignUpButton } from "@/components/pricing/SignUpButton";

type PlanActionProps = {
  plan: "free" | "pro";
  /** Signed out: Clerk's sign-up, then the upload page (Free) or the pricing page and its checkout (Pro). */
  signedOut: string;
  /** Signed in: a link to the same page, which knows the reader's plan. */
  signedIn: string;
};

/** A plan's action on the landing, which doesn't read the session on the server. */
export function PlanAction({ plan, signedOut, signedIn }: PlanActionProps) {
  const href = plan === "free" ? "/resume/upload" : "/pricing";
  const variant = plan === "free" ? "ghost" : "solid";
  return (
    <>
      <SignedOut>
        <SignUpButton label={signedOut} redirect={href} variant={variant} className="max-sm:w-full" />
      </SignedOut>
      <SignedIn>
        <ButtonLink href={href} variant={variant} className="max-sm:w-full">
          {signedIn}
        </ButtonLink>
      </SignedIn>
    </>
  );
}
