"use client";

import { useTransition } from "react";
import { buttonClass } from "@/components/design-system/Button";
import { Logo } from "@/components/design-system/Logo";
import { StatusMark } from "@/components/design-system/StatusMark";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { digestOf, errorCopy } from "./utils/copy";

type GlobalErrorScreenProps = {
  error: unknown;
  retry: () => void;
  className?: string;
};

const en = errorCopy("en");
const es = errorCopy("es");

/** One action in both languages: "Try again · Volver a intentar". */
const both = (key: Parameters<typeof en>[0]) => `${en(key)} · ${es(key)}`;

/**
 * The last resort: the root layout itself failed, so there are no providers, no locale and no header. It says what
 * happened in both interface languages, English first, each marked with its `lang`, and offers the same two ways out
 * as every error page. The body of `app/global-error.tsx` (which adds the document) and of the dev preview.
 */
export default function GlobalErrorScreen({ error, retry, className }: GlobalErrorScreenProps) {
  const digest = digestOf(error);
  const [retrying, startRetry] = useTransition();

  return (
    <div className={cn("flex min-h-dvh flex-1 flex-col", className)}>
      <title>{`${en("meta")} · ${BRAND.name}`}</title>
      <div className="chrome border-b border-line bg-bg">
        <div className="wrap flex h-16 items-center">
          <a href="/" aria-label={both("home")} className="inline-flex min-h-11 items-center no-underline">
            <Logo />
          </a>
        </div>
      </div>
      <main className="flex flex-1 flex-col">
        <section aria-labelledby="global-error-title" className="wrap page-grid w-full flex-1 content-center gap-y-5 py-[clamp(64px,10vw,128px)]">
          <h1 id="global-error-title" className="text-title font-semibold text-balance text-ink sm:text-[clamp(32px,3.6vw,48px)] lg:col-span-8">
            {en("title")}
            <span lang="es" className="mt-2 block font-normal text-ink-2">
              {es("title")}
            </span>
          </h1>
          <div className="grid max-w-[120ch] gap-x-gutter gap-y-4 text-lede text-ink-2 sm:grid-cols-2 lg:col-span-10">
            <p lang="en">{en("body")}</p>
            <p lang="es">{es("body")}</p>
          </div>
          <p className="mono flex flex-wrap items-center gap-x-2.5 gap-y-1 text-micro text-ink-2">
            <StatusMark status="missing" />
            <span>{en("status")}</span>
            {digest && (
              <>
                <span aria-hidden>·</span>
                <span data-error-reference className="[overflow-wrap:anywhere]">{`${en("reference", { digest })} · ${es("reference", { digest })}`}</span>
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => startRetry(() => retry())}
              disabled={retrying}
              className={buttonClass({ className: "whitespace-normal text-center disabled:cursor-progress disabled:opacity-60 disabled:hover:translate-y-0" })}
            >
              {retrying ? both("retrying") : both("retry")}
            </button>
            <a href="/" className={buttonClass({ variant: "ghost", className: "whitespace-normal text-center" })}>
              {both("home")}
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
