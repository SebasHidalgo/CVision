import { getT } from "@/lib/i18n/server";
import { FeedbackState } from "./FeedbackPage";
import { StatusLine } from "./StatusLine";

type FeedbackUnavailableProps = {
  role: string;
  date: string;
};

/** A completed interview whose stored feedback no longer matches the schema. */
export default async function FeedbackUnavailable({ role, date }: FeedbackUnavailableProps) {
  const t = await getT("feedback");
  return (
    <FeedbackState role={role} date={date} t={t}>
      <StatusLine kind="unreadable" title={t("unavailable.title")} body={t("unavailable.body")} />
    </FeedbackState>
  );
}
