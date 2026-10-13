import ResumeUploadScreen from "@/screens/ResumeUpload/ResumeUploadScreen";

// Bounds analyzeResumeAction end to end: the 10 s storage download, the PDF
// parse, the 30 s AI timeout and the database write run in sequence. A
// literal, as Next requires.
export const maxDuration = 60;

export default function UploadResumePage() {
  return <ResumeUploadScreen />;
}
