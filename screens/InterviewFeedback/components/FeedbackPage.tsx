import type { TFunction } from "i18next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { textLinkClass } from "@/components/design-system/Button";
import { fontText } from "@/components/design-system/fonts";
import { EYEBROW } from "@/components/interview/feedback/parts";
import { cn } from "@/lib/utils";

/** The page root of the new design: the plain dark canvas, as wide as the shell. */
export function FeedbackPage({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div className="wrap pt-[clamp(32px,5vw,64px)] pb-section">{children}</div>
    </div>
  );
}

/**
 * A feedback page with no report yet, or none to show: the same head as the report (when, what was rehearsed), then
 * what is going on and what is left to do, and always the way back to the list. `status` makes the explanation a live
 * region (the waiting states). Sync, with the caller's t: the states render in one pass, on the server or in a test.
 */
export function FeedbackState({
  role,
  date,
  t,
  status = false,
  children,
  actions,
}: {
  role: string;
  date: string;
  t: TFunction<"feedback">;
  status?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <FeedbackPage>
      <article aria-labelledby="feedback-title">
        <header className="page-grid border-b border-line-2 pb-[clamp(32px,4.5vw,56px)]">
          <div className="lg:col-[1/span_8]">
            <p className={EYEBROW}>{t("header.eyebrow", { date })}</p>
            <p className="mt-6 text-lede text-ink-2">{t("header.kicker")}</p>
            <h1 id="feedback-title" className="display mt-1 text-h2 text-balance break-words text-ink">
              {role}
            </h1>
          </div>
        </header>
        <section className="page-grid py-[clamp(40px,5.5vw,72px)]" {...(status ? { role: "status", "aria-live": "polite" as const } : {})}>
          <div className="lg:col-[1/span_8]">
            {children}
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
              {actions}
              <Link href="/interviews" className={cn(textLinkClass, "gap-2")}>
                <ArrowLeft aria-hidden className="size-4" />
                {t("actions.allInterviews")}
              </Link>
            </div>
          </div>
        </section>
      </article>
    </FeedbackPage>
  );
}
