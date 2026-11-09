import ResumeUploadScreen from "@/screens/ResumeUpload/ResumeUploadScreen";

// Bounds analyzeResumeAction end to end: the 10 s storage download, the PDF
// parse, the 30 s AI timeout (twice when the first answer is not English) and
// the database write run in sequence. A literal, as Next requires.
export const maxDuration = 90;

export default function UploadResumePage() {
  return <ResumeUploadScreen />;
}
