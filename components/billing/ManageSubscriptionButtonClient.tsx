"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/components/design-system/Button";
import { useErrorCopy } from "@/hooks/useErrorCopy";
import { cn } from "@/lib/utils";
import { createPortalSessionAction } from "./actions/createPortalSessionAction";
import { BILLING_BUTTON } from "./buttonStyle";

export type ManageSubscriptionButtonProps = {
  /** "Manage subscription" unless the screen says otherwise. */
  label?: string;
  className?: string;
  variant?: "default" | "outline";
};

/**
 * Opens the provider's portal, minted per click because the link expires.
 * No tab is opened before the link exists: a tab that opens and closes on
 * a failure is worse than no tab. The new tab is opened once the link is
 * back; browsers allow that for a few seconds after the click, and if this
 * one does not (the popup is blocked), the portal opens in this tab. A
 * failure is shown here, under the button, in words that blame nobody.
 * Rendered through ManageSubscriptionButton, which sends it the billing
 * namespace.
 */
export default function ManageSubscriptionButtonClient({ label, className, variant = "outline" }: ManageSubscriptionButtonProps) {
  const { t } = useTranslation("billing");
  const errorCopy = useErrorCopy();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const handleClick = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await createPortalSessionAction();
      if (!result.ok) {
        setProblem(errorCopy(result.code, result.meta));
      } else {
        openPortal(result.data.url);
      }
    } catch {
      setProblem(errorCopy("REQUEST_FAILED"));
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-busy={busy || undefined}
        className={buttonClass({ variant: variant === "default" ? "solid" : "ghost", className: cn(BILLING_BUTTON, className) })}
      >
        {busy ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <ExternalLink aria-hidden className="size-4" />}
        {label ?? t("portal.manage")}
      </button>
      {problem && (
        <p role="alert" className="max-w-[52ch] text-ed-small text-ed-danger-text">
          {problem}
        </p>
      )}
    </div>
  );
}

/** A new tab when the browser allows one this long after the click; this tab otherwise. */
export function openPortal(url: string): "tab" | "here" {
  const tab = window.open(url, "_blank");
  if (tab) {
    tab.opener = null;
    return "tab";
  }
  window.location.assign(url);
  return "here";
}
