import ResumeAnalysesScreen from "@/screens/ResumeAnalyses/ResumeAnalysesScreen";

// Bounds deleteHiddenAnalysesAction: one deletion cascade after another (rows, the stored CV, the voice
// conversations), which stops starting new ones at 40 s and reports what's left. A literal, as Next requires.
export const maxDuration = 60;

export default function AnalysesPage() {
  return <ResumeAnalysesScreen />;
}
