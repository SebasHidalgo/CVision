import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import ClientMessages from "@/components/i18n/ClientMessages";
import Eyebrow from "@/components/layout/Eyebrow";
import { getT } from "@/lib/i18n/server";
import type { InterviewStatusSnapshot } from "@/lib/schemas/interviewSessionSchema";
import StatusPoller from "./StatusPoller";

type FeedbackPendingProps = {
  interviewId: string;
  /** The analysis the attempts are listed under; null when it was deleted. */
  analysisId: string | null;
  role: string;
  date: string;
  /**
   * "transcript": the call just ended and the platform has not delivered the
   * transcript yet. "scoring": the transcript is stored and being read.
   */
  waitingFor: "transcript" | "scoring";
  /** What this render is based on; the poller re-renders when it changes. */
  seen: Pick<InterviewStatusSnapshot, "status" | "hasFeedback" | "failureReason">;
};

/** Shown while the interview is being saved or scored; polls until it is, or until the ceiling. */
export default async function FeedbackPending({
  interviewId,
  analysisId,
  role,
  date,
  waitingFor,
  seen,
}: FeedbackPendingProps) {
  const t = await getT("feedback");

  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>{t("header.eyebrow", { date })}</Eyebrow>
        <p className="mt-6 text-lg text-ink-2">{t("header.kicker")}</p>
        <h1 className="display-lg mt-1 text-ink">{role}</h1>
      </header>

      <section className="py-12 lg:py-16" role="status" aria-live="polite">
        {/* The poller's stalled notice is client copy. */}
        <ClientMessages ns={["feedback"]}>
          <StatusPoller
            interviewId={interviewId}
            seen={seen}
            attemptsHref={analysisId ? `/resume/analysis/${analysisId}` : "/interviews"}
          >
            <p className="flex items-center gap-3 text-lg text-ink">
              <Loader2 aria-hidden className="size-5 animate-spin text-signal" />
              {waitingFor === "transcript" ? t("pending.saving") : t("pending.preparing")}
            </p>
            <p className="lede mt-4 max-w-xl">
              {waitingFor === "transcript" ? t("pending.transcriptBody") : t("pending.scoringBody")}
            </p>
            <p className="mt-6 text-sm text-ink-3">{t("pending.leave")}</p>
          </StatusPoller>
        </ClientMessages>
        <Link
          href="/interviews"
          className="link-rule mt-10 inline-flex items-center gap-2 px-2 text-sm text-ink-2"
        >
          <ArrowLeft className="size-4" />
          {t("actions.allInterviews")}
        </Link>
      </section>
    </article>
  );
}
