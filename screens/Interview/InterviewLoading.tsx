import { fontText } from "@/components/design-system/fonts";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { RoomSkeleton } from "./components/RoomSkeleton";

/** The room while the server reads the interview, settles its last call and asks after the voice service. */
export default async function InterviewLoading() {
  const t = await getT("interview");
  return (
    <div className={cn("ed-root flex flex-1 flex-col", fontText.variable)}>
      <RoomSkeleton status={t("room.loading")} />
    </div>
  );
}
