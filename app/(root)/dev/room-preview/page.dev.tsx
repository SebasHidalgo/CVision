import RoomPreviewScreen from "@/screens/Interview/RoomPreviewScreen";

export default async function RoomPreviewPage({ searchParams }: { searchParams: Promise<{ drip?: string; closing?: string }> }) {
  const { drip, closing } = await searchParams;
  return <RoomPreviewScreen drip={drip === "1"} closing={closing === "1"} />;
}
