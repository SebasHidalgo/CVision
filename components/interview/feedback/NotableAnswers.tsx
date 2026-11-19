import type { TFunction } from "i18next";
import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import { InkMark, ReportSection, SpokenQuote, type HeadingLevel, type ProseRenderer } from "./parts";

/** "Answers that stood out": the candidate's words, whether they helped, and why. Only answers with their quote. */
export function NotableAnswers({
  answers,
  id,
  level,
  embedded,
  prose,
  t,
}: {
  answers: InterviewFeedbackReport["notableAnswers"];
  id: string;
  level: HeadingLevel;
  embedded: boolean;
  prose: ProseRenderer;
  t: TFunction<"feedback">;
}) {
  return (
    <ReportSection part="answers" id={id} eyebrow={t("report.answers.eyebrow")} title={t("report.answers.title")} level={level} embedded={embedded}>
      <ul className="grid grid-cols-1 gap-x-8 gap-y-8 xl:grid-cols-2">
        {answers.map((answer, i) => (
          <li key={i} data-feedback-row="answer" data-worked={answer.worked} className="flex min-w-0 flex-col border-t border-ed-line pt-4">
            <p className="ed-cap inline-flex items-center gap-2 text-ed-ink">
              <InkMark shape={answer.worked ? "full" : "empty"} />
              {answer.worked ? t("report.answers.worked") : t("report.answers.didntLand")}
            </p>
            <SpokenQuote text={answer.quote} className="mt-3.5" />
            <p className="mt-3 max-w-[68ch] text-ed-body text-ed-ink-2">
              {prose(answer.why)}
            </p>
          </li>
        ))}
      </ul>
    </ReportSection>
  );
}
