import RoomPreviewScreen from "@/screens/Interview/RoomPreviewScreen";

export default async function RoomPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string; drip?: string; closing?: string }> }) {
  const { state, drip, closing } = await searchParams;
  return <RoomPreviewScreen state={state} drip={drip === "1"} closing={closing === "1"} />;
}
