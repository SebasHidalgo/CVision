import InterviewLoading from "@/screens/Interview/InterviewLoading";

// In a route group so it wraps the room alone: a loading.tsx beside feedback/ would show the room's frame on the way
// to the feedback page too.
export default function Loading() {
  return <InterviewLoading />;
}
