import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

type InterviewMayBeLiveProps = {
  interview: { id: string; role: string };
  date: string;
};

/**
 * The feedback page opened by hand during a session that may still be
 * running in another tab. No redirect: the room would offer a Start, and a
 * start is paid. The link is there for the case where the call is in fact
 * over and nothing reported it.
 */
export default async function InterviewMayBeLive({ interview, date }: InterviewMayBeLiveProps) {
  const t = await getT("feedback");

  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>{t("header.eyebrow", { date })}</Eyebrow>
        <p className="mt-6 text-lg text-ink-2">{t("header.kicker")}</p>
        <h1 className="display-lg mt-1 text-ink">{interview.role}</h1>
      </header>

      <section className="py-12 lg:py-16" role="status">
        <p className="flex items-center gap-3 text-lg text-ink">
          <span aria-hidden className="glow-signal size-2 shrink-0 rounded-full bg-signal animate-blink" />
          {t("mayBeLive.title")}
        </p>
        <p className="lede mt-4 max-w-xl">{t("mayBeLive.body")}</p>

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
