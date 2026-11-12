import RoomPreviewScreen from "@/screens/Interview/RoomPreviewScreen";

export default async function RoomPreviewPage({ searchParams }: { searchParams: Promise<{ drip?: string }> }) {
  const { drip } = await searchParams;
  return <RoomPreviewScreen drip={drip === "1"} />;
}
