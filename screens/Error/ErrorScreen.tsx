"use client";

import { useEffect, useRef, useTransition } from "react";
import { buttonClass } from "@/components/design-system/Button";
import { fontText } from "@/components/design-system/fonts";
import { Logo } from "@/components/design-system/Logo";
import { StatusMark } from "@/components/design-system/StatusMark";
import { useLocale } from "@/hooks/useLocale";
import { reveal } from "@/lib/bootScript";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { digestOf, errorCopy } from "./utils/copy";

type ErrorScreenProps = {
  error: unknown;
  /** Next's retry: fetches and renders the failed segment again. */
  retry: () => void;
  /**
   * shell: an app page failed under the shell's header and footer, which stay. bare: the landing or the shell itself
   * failed, so the page draws its own band with the wordmark.
   */
  variant: "shell" | "bare";
};

/**
 * What a page that failed to render shows: that it was on our side, a way to try again and a way home. Never the
 * error's message or stack (they can carry details); the digest of a server error, so support can find its log line.
 */
export default function ErrorScreen({ error, retry, variant }: ErrorScreenProps) {
  const t = errorCopy(useLocale());
  const digest = digestOf(error);
  const [retrying, startRetry] = useTransition();
  const title = useRef<HTMLHeadingElement>(null);

  // The page changed under the reader: take them to what it now says. A landing that failed under its loader lets go
  // of the loader's scroll lock now instead of at its cap.
  useEffect(() => {
    reveal();
    title.current?.focus({ preventScroll: true });
  }, []);

  const body = (
    <section aria-labelledby="error-title" className="wrap page-grid w-full flex-1 content-center gap-y-5 py-[clamp(64px,10vw,128px)]">
      <title>{`${t("meta")} · ${BRAND.name}`}</title>
      <h1 ref={title} id="error-title" tabIndex={-1} className="display text-h2 text-balance text-ink focus:outline-none lg:col-span-8">
        {t("title")}
      </h1>
      <p className="max-w-[60ch] text-lede text-ink-2 lg:col-span-7">{t("body")}</p>
      {/* What happened, by its mark and in words, as on the 404; with the server log's reference when there is one. */}
      <p className="mono flex flex-wrap items-center gap-x-2.5 gap-y-1 text-micro text-ink-2">
        <StatusMark status="missing" />
        <span>{t("status")}</span>
        {digest && (
          <>
            <span aria-hidden>·</span>
            <span data-error-reference className="[overflow-wrap:anywhere]">
              {t("reference", { digest })}
            </span>
          </>
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => startRetry(() => retry())}
          disabled={retrying}
          className={buttonClass({ className: "disabled:cursor-progress disabled:opacity-60 disabled:hover:translate-y-0" })}
        >
          {retrying ? t("retrying") : t("retry")}
        </button>
        {/* A full load: whatever state broke this page is left behind. */}
        <a href="/" className={buttonClass({ variant: "ghost" })}>
          {t("home")}
        </a>
      </div>
    </section>
  );

  if (variant === "shell") {
    return <div className={cn("root flex flex-1 flex-col", fontText.variable)}>{body}</div>;
  }
  return (
    <div className={cn("root flex min-h-dvh flex-1 flex-col", fontText.variable)}>
      <div className="chrome border-b border-line bg-bg">
        <div className="wrap flex h-16 items-center">
          <a href="/" aria-label={t("home")} className="inline-flex min-h-11 items-center no-underline">
            <Logo />
          </a>
        </div>
      </div>
      <main className="flex flex-1 flex-col">{body}</main>
    </div>
  );
}
