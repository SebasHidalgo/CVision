"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
 * Opens the provider's portal in a new tab. The tab is opened before the
 * await, while the click is still the user's gesture, and receives the
 * URL after: a tab opened later would be blocked as a popup. The link is
 * minted per click because it expires.
 */
export default function ManageSubscriptionButton({ label = "Manage subscription", className, variant = "outline" }: ManageSubscriptionButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    const popup = window.open("about:blank", "_blank");
    try {
      const result = await createPortalSessionAction();
      if (!result.ok) {
        popup?.close();
        toast.error(actionErrorCopy(result.code, result.meta));
      } else if (popup) {
        popup.location.href = result.data.url;
      } else {
        window.location.href = result.data.url;
      }
    } catch {
      popup?.close();
      toast.error(actionErrorCopy("REQUEST_FAILED"));
    }
    setBusy(false);
  };

  return (
    <Button onClick={handleClick} disabled={busy} variant={variant} className={cn("gap-2", className)}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
      {label}
    </Button>
  );
}
