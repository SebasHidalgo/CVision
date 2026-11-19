"use client";

import { fontText } from "@/components/design-system/fonts";
import { cn } from "@/lib/utils";
import GlobalErrorScreen from "../GlobalErrorScreen";

/** Dev only: the root error page's body as a page, with an invented digest; retrying reloads. */
export default function GlobalErrorPreview() {
  return (
    <div className={cn("ed-root flex min-h-dvh flex-1 flex-col", fontText.variable)}>
      <GlobalErrorScreen error={{ digest: "dev-preview" }} retry={() => window.location.reload()} />
    </div>
  );
}
