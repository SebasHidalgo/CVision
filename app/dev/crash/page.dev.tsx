import ErrorPreviewScreen from "@/screens/Error/ErrorPreviewScreen";

// Outside the app's shell on purpose: a failure here reaches the root boundary, app/error.tsx.
export default async function CrashPreviewPage({ searchParams }: { searchParams: Promise<{ at?: string; view?: string }> }) {
  const { at, view } = await searchParams;
  return <ErrorPreviewScreen at={at} view={view} />;
}
