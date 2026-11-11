"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/types/action";

type TranslationPendingProps<I> = {
  /** The screen's translate action; the server decides what to translate and whether it is the caller's. */
  translate: (input: I) => Promise<ActionResult<{ outcome: string }>>;
  input: I;
  className?: string;
};

/**
 * The status line over a page whose prose is waiting for its translation (the prose itself shows
 * skeletons): calls the action once, then refreshes in place. A call that never reached the server
 * offers the original instead of looping.
 */
export default function TranslationPending<I>({ translate, input, className }: TranslationPendingProps<I>) {
  const { t } = useTranslation("common");
  const router = useRouter();
  const pathname = usePathname();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    translate(input).then(
      () => router.refresh(),
      () => setFailed(true),
    );
  }, [translate, input, router]);

  if (failed) {
    return (
      <p role="status" className={cn("eyebrow flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2", className)}>
        <span aria-hidden className="size-1.5 shrink-0 bg-fair" />
        {t("translation.unavailable")}
        <Link href={`${pathname}?original=1`} className="link-rule text-ink">
          {t("translation.showOriginal")}
        </Link>
      </p>
    );
  }

  return (
    <p role="status" aria-live="polite" className={cn("eyebrow flex items-center gap-3 text-ink-2", className)}>
      <span aria-hidden className="size-1.5 shrink-0 animate-pulse bg-signal" />
      {t("translation.pending")}
    </p>
  );
}
