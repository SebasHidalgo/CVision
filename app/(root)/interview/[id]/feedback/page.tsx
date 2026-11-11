import InterviewFeedbackScreen from "@/screens/InterviewFeedback/InterviewFeedbackScreen";

// Bounds the lazy feedback generation this page can start (after() while
// pending, or inline from the retry action): a 45 s model call, a second one
// when the first was not in English, plus writes. A literal, as Next requires.
export const maxDuration = 105;

type InterviewFeedbackPageParams = Promise<{ id: string }>;
type InterviewFeedbackPageSearch = Promise<{ ended?: string | string[]; original?: string | string[] }>;

export default async function InterviewFeedbackPage({
  params,
  searchParams,
}: {
  params: InterviewFeedbackPageParams;
  searchParams: InterviewFeedbackPageSearch;
}) {
  const [{ id }, { ended, original }] = await Promise.all([params, searchParams]);

  return <InterviewFeedbackScreen interviewId={id} justEnded={ended === "1"} original={original === "1"} />;
}
