import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import { Button } from "@/components/ui/button";
import { PLANS } from "@/lib/plans";

const LIMIT = PLANS.FREE.historyLimit ?? 0;

type HistoryNoticeProps = {
  /** How many analyses, or interviews, the plan is hiding. */
  hidden: number;
  what: "analyses" | "interviews";
};

/** The one line under a list when the Free history rule is hiding something. Pro reveals it; nothing was deleted. */
export function HistoryLine({ hidden, what }: HistoryNoticeProps) {
  if (hidden === 0) return null;
  const noun = what === "analyses" ? (hidden === 1 ? "analysis" : "analyses") : hidden === 1 ? "interview" : "interviews";
  return (
    <p className="mt-6 text-sm text-ink-2">
      {hidden} older {noun} {hidden === 1 ? "is" : "are"} in your history. Free shows your last {LIMIT} analyses; Pro shows everything, nothing is
      deleted.{" "}
      <Link href="/pricing" className="link-rule font-medium text-ink">
        See Pro
      </Link>
    </p>
  );
}

type HiddenPageProps = {
  /** "analysis" for the analysis page; the interviews of a hidden analysis go through their list. */
  title: string;
};

/** What a hidden analysis's page shows instead of its content. */
export default function HistoryNotice({ title }: HiddenPageProps) {
  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>In your history</Eyebrow>
        <h1 className="display-lg mt-6 text-ink">{title}</h1>
      </header>
      <section className="py-12 lg:py-16">
        <p className="lede max-w-xl">
          This analysis is older than the last {LIMIT} on your account. Free shows the most recent {LIMIT}; Pro shows all of them, and
          nothing here is deleted. Upgrade and it comes back exactly as it was, with its interviews.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Button asChild className="h-11 gap-2 px-5">
            <Link href="/pricing">
              See Pro
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Link href="/resume/analyses" className="link-rule px-2 text-sm text-ink-2">
            Back to your analyses
          </Link>
        </div>
      </section>
    </article>
  );
}
