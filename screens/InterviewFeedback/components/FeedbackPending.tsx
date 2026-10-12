import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import RefreshPoller from "./RefreshPoller";

type FeedbackPendingProps = {
  role: string;
  date: string;
};

/** Shown while the transcript is being scored; polls until it is. */
export default function FeedbackPending({ role, date }: FeedbackPendingProps) {
  return (
    <article className="wrap py-10 lg:py-14">
      <RefreshPoller />
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>Interview feedback · {date}</Eyebrow>
        <p className="mt-6 text-lg text-ink-2">Mock interview</p>
        <h1 className="display-lg mt-1 text-ink">{role}</h1>
      </header>

      <section className="py-12 lg:py-16" role="status" aria-live="polite">
        <p className="flex items-center gap-3 text-lg text-ink">
          <Loader2 aria-hidden className="size-5 animate-spin text-signal" />
          Preparing your feedback.
        </p>
        <p className="lede mt-4 max-w-xl">
          The transcript is being read against the posting and the gaps your
          analysis found. This usually takes under a minute; the page updates
          by itself.
        </p>
        <p className="mt-6 text-sm text-ink-3">
          If nothing changes after a couple of minutes, reload the page.
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
