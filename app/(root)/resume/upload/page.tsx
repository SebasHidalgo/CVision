import ResumeUploadScreen from "@/screens/ResumeUpload/ResumeUploadScreen";

// Bounds analyzeResumeAction end to end. The action runs on a 95 s budget inside
// it (screens/ResumeUpload/utils/budget.ts): a retry's wait for an earlier
// request, the 10 s download and the parse, the 30 s analysis call, then the
// optional calls (the English retry, the repair) only on what is left, then the
// save. A literal, as Next requires; budget.test.ts reads it.
export const maxDuration = 100;

export default function UploadResumePage() {
  return <ResumeUploadScreen />;
}
