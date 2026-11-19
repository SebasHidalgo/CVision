import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/design-system/Button";
import { getT } from "@/lib/i18n/server";
import { FeedbackState } from "./FeedbackPage";
import { StatusLine } from "./StatusLine";

type AttemptNotScoredProps = {
  interview: { id: string; role: string };
  /** "silent": the platform heard nothing. "lost": it has no record of the session. "failed": it could not run the call. */
  reason: "silent" | "lost" | "failed" | "busy";
  /** Starts (connections) this interview can still issue. */
  startsLeft: number;
  date: string;
};

/** What the start that just ended did to the count: a call the platform could not run is given back. */
const STARTS_KEY = {
  silent: "notScored.startCounted",
  lost: "notScored.startCounted",
  failed: "notScored.startReturned",
  busy: "notScored.startReturned",
} as const;

/**
 * The latest call produced nothing to score and the interview is still
 * startable, so the way forward is the room, not a retry of the scoring.
 */
export default async function AttemptNotScored({ interview, reason, startsLeft, date }: AttemptNotScoredProps) {
  const t = await getT("feedback");

  return (
    <FeedbackState
      role={interview.role}
      date={date}
      t={t}
      actions={
        <ButtonLink href={`/interview/${interview.id}`}>
          {t("actions.backToRoom")}
          <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
      }
    >
      <StatusLine
        kind="stopped"
        title={t(`notScored.${reason}.title`)}
        body={`${t(`notScored.${reason}.body`)} ${t(STARTS_KEY[reason], { count: startsLeft })}`}
      />
    </FeedbackState>
  );
}
