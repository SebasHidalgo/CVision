"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import SignInCta from "./SignInCta";

type SignInCtaButtonProps = {
  mode?: "signIn" | "signUp";
  forceRedirectUrl?: string;
  size?: "default" | "sm" | "lg";
  variant?: "default" | "outline" | "ghost";
  className?: string;
  /** Trailing arrow, animated on hover of the `group` button. */
  arrow?: boolean;
  /** Text only: an element here would be rendered by the caller, which is the case this component exists to avoid. */
  children: string;
};

/**
 * A sign-in (or sign-up) trigger with its button and icon rendered on the
 * client side. Under Next 16 / React 19.3, a client component's child
 * element that carries an element rendered by a Server Component (an
 * icon inside the button) is dropped from the server-rendered HTML and
 * reappears on the client, which React reports as a hydration mismatch on
 * every signed-out visit (proved on the pricing page: the button rendered
 * on the server with a text child and not with the icon). With the icon
 * created here, both sides render the same tree.
 */
export default function SignInCtaButton({ mode, forceRedirectUrl, size = "lg", variant, className, arrow = false, children }: SignInCtaButtonProps) {
  return (
    <SignInCta mode={mode} forceRedirectUrl={forceRedirectUrl}>
      <Button size={size} variant={variant} className={className}>
        {children}
        {arrow && <ArrowRight className="size-5 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />}
      </Button>
    </SignInCta>
  );
}
