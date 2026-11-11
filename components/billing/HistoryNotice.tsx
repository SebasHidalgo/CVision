import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { PLANS } from "@/lib/plans";

const LIMIT = PLANS.FREE.historyLimit ?? 0;

type HistoryNoticeProps = {
  /** How many analyses, or interviews, the plan is hiding. */
  hidden: number;
  what: "analyses" | "interviews";
};

/** The one line under a list when the Free history rule is hiding something. Pro reveals it; nothing was deleted. */
export async function HistoryLine({ hidden, what }: HistoryNoticeProps) {
  if (hidden === 0) return null;
  const t = await getT("billing");
  return (
    <p className="mt-6 text-sm text-ink-2">
      {t(what === "analyses" ? "history.line.analyses" : "history.line.interviews", { count: hidden, limit: LIMIT })}{" "}
      <Link href="/pricing" className="link-rule font-medium text-ink">
        {t("history.seePro")}
      </Link>
    </p>
  );
}

type HiddenPageProps = {
  /** "analysis" for the analysis page; the interviews of a hidden analysis go through their list. Already translated. */
  title: string;
};

/** What a hidden analysis's page shows instead of its content. */
export default async function HistoryNotice({ title }: HiddenPageProps) {
  const t = await getT("billing");
  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>{t("history.eyebrow")}</Eyebrow>
        <h1 className="display-lg mt-6 text-ink">{title}</h1>
      </header>
      <section className="py-12 lg:py-16">
        <p className="lede max-w-xl">{t("history.body", { limit: LIMIT })}</p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button asChild className="h-11 gap-2 px-5">
            <Link href="/pricing">
              {t("history.seePro")}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Link href="/resume/analyses" className="link-rule px-2 text-sm text-ink-2">
            {t("history.back")}
          </Link>
        </div>
      </section>
    </article>
  );
}
