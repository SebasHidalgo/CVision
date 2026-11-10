import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

type AttemptNotScoredProps = {
  interview: { id: string; role: string };
  /** "silent": the platform heard nothing. "lost": it has no record of the session. "failed": it could not run the call. */
  reason: "silent" | "lost" | "failed";
  /** Starts (connections) this interview can still issue. */
  startsLeft: number;
  date: string;
};

/** What the start that just ended did to the count: a call the platform could not run is given back. */
const STARTS_KEY = {
  silent: "notScored.startCounted",
  lost: "notScored.startCounted",
  failed: "notScored.startReturned",
} as const;

/**
 * The latest call produced nothing to score and the interview is still
 * startable, so the way forward is the room, not a retry of the scoring.
 */
export default async function AttemptNotScored({ interview, reason, startsLeft, date }: AttemptNotScoredProps) {
  const t = await getT("feedback");

  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>{t("header.eyebrow", { date })}</Eyebrow>
        <p className="mt-6 text-lg text-ink-2">{t("header.kicker")}</p>
        <h1 className="display-lg mt-1 text-ink">{interview.role}</h1>
      </header>

      <section className="py-12 lg:py-16">
        <p className="flex items-center gap-3 text-lg text-ink">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-weak" />
          {t(`notScored.${reason}.title`)}
        </p>
        <p className="lede mt-4 max-w-xl">
          {t(`notScored.${reason}.body`)} {t(STARTS_KEY[reason], { count: startsLeft })}
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button asChild className="h-11 gap-2 px-5">
            <Link href={`/interview/${interview.id}`}>
              {t("actions.backToRoom")}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Link
            href="/interviews"
            className="link-rule inline-flex items-center gap-2 px-2 text-sm text-ink-2"
          >
            <ArrowLeft className="size-4" />
            {t("actions.allInterviews")}
          </Link>
        </div>
      </section>
    </article>
  );
}
