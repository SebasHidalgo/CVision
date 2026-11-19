import InterviewsScreen from "@/screens/Interviews/InterviewsScreen";

// Bounds deleteHiddenInterviewsAction: one deletion cascade after another (rows, then the voice conversations), which
// stops starting new ones at 40 s and reports what's left. A literal, as Next requires.
export const maxDuration = 60;

export default function InterviewsPage() {
  return <InterviewsScreen />;
}
