"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/types/action";
import { STATUS_LINE, STATUS_LINK, StatusText } from "./TranslationStatus";

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
      <p role="status" className={cn(STATUS_LINE, className)}>
        <StatusText>{t("translation.unavailable")}</StatusText>
        <Link href={`${pathname}?original=1`} className={STATUS_LINK}>
          {t("translation.showOriginal")}
        </Link>
      </p>
    );
  }

  return (
    <p role="status" aria-live="polite" className={cn(STATUS_LINE, className)}>
      <StatusText pulse>{t("translation.pending")}</StatusText>
    </p>
  );
}
