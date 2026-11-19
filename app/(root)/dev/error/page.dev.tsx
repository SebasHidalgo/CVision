import ErrorPreviewScreen from "@/screens/Error/ErrorPreviewScreen";

export default async function ErrorPreviewPage({ searchParams }: { searchParams: Promise<{ at?: string }> }) {
  const { at } = await searchParams;
  return <ErrorPreviewScreen at={at} />;
}
