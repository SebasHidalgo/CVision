"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { ActionResult } from "@/types/action";

type TranslationPendingProps<I> = {
  /** The screen's translate action; the server decides what to translate and whether it is the caller's. */
  translate: (input: I) => Promise<ActionResult<{ outcome: string }>>;
  input: I;
};

/**
 * "Translating…" in place of content that has no translation yet: calls the action once, then
 * refreshes, and the server renders the stored translation (or the original with its notice). A
 * call that never reached the server offers the original instead of looping.
 */
export default function TranslationPending<I>({ translate, input }: TranslationPendingProps<I>) {
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
      <div role="status" className="wrap py-16 text-ink-2">
        <p>{t("translation.unavailable")}</p>
        <Link href={`${pathname}?original=1`} className="link-rule mt-4 inline-block text-ink">
          {t("translation.showOriginal")}
        </Link>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="wrap flex flex-col gap-3 py-16">
      <p className="eyebrow flex items-center gap-3">
        <span aria-hidden className="size-1.5 shrink-0 animate-pulse bg-signal" />
        {t("translation.pending")}
      </p>
      <p className="lede max-w-xl">{t("translation.pendingBody")}</p>
    </div>
  );
}
