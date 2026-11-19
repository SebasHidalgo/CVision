import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/design-system/Button";
import { getT } from "@/lib/i18n/server";
import { FeedbackState } from "./FeedbackPage";
import { StatusLine } from "./StatusLine";

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
    <FeedbackState
      role={interview.role}
      date={date}
      t={t}
      status
      actions={
        <ButtonLink href={`/interview/${interview.id}`}>
          {t("actions.backToRoom")}
          <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
      }
    >
      <StatusLine kind="live" title={t("mayBeLive.title")} body={t("mayBeLive.body")} />
    </FeedbackState>
  );
}
