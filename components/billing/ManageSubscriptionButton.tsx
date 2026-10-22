"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import { cn } from "@/lib/utils";
import { createPortalSessionAction } from "./actions/createPortalSessionAction";

type ManageSubscriptionButtonProps = {
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
 */
export default function ManageSubscriptionButton({ label = "Manage subscription", className, variant = "outline" }: ManageSubscriptionButtonProps) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const handleClick = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await createPortalSessionAction();
      if (!result.ok) {
        setProblem(actionErrorCopy(result.code, result.meta));
      } else {
        openPortal(result.data.url);
      }
    } catch {
      setProblem(actionErrorCopy("REQUEST_FAILED"));
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={handleClick} disabled={busy} variant={variant} className={cn("gap-2", className)}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
        {label}
      </Button>
      {problem && (
        <p role="alert" className="text-sm text-ink-2">
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
