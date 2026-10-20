import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";

type FeedbackUnavailableProps = {
  role: string;
  date: string;
};

/** A completed interview whose stored feedback no longer matches the schema. */
export default function FeedbackUnavailable({ role, date }: FeedbackUnavailableProps) {
  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>Interview feedback · {date}</Eyebrow>
        <p className="mt-6 text-lg text-ink-2">Mock interview</p>
        <h1 className="display-lg mt-1 text-ink">{role}</h1>
      </header>

      <section className="py-12 lg:py-16">
        <p className="text-lg text-ink">This feedback can&apos;t be shown.</p>
        <p className="lede mt-4 max-w-xl">
          It was written in a format this version no longer reads. Rehearse the
          interview again from its analysis to get a fresh report.
        </p>
        <Link
          href="/interviews"
          className="link-rule mt-10 inline-flex items-center gap-2 px-2 text-sm text-ink-2"
        >
          <ArrowLeft className="size-4" />
          All interviews
        </Link>
      </section>
    </article>
  );
}
