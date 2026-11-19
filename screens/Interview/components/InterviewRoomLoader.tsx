"use client";

import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import type { InterviewAgentProps } from "./InterviewAgent";
import { RoomSkeleton } from "./RoomSkeleton";

/** What shows while the room's chunk loads: the same frame as the route's loading state, so nothing jumps. */
function RoomLoading() {
  const { t } = useTranslation("interview");
  return <RoomSkeleton status={t("room.loading")} />;
}

/**
 * The room is the one page that needs the voice SDK, and the SDK carries a
 * WebRTC client of a few hundred kilobytes. Loading it on demand, without
 * server rendering, keeps it out of every other page's chunk graph and out
 * of the server bundle, where it has nothing to do.
 */
const InterviewAgent = dynamic(() => import("./InterviewAgent"), {
  ssr: false,
  loading: () => <RoomLoading />,
});

export default function InterviewRoomLoader(props: InterviewAgentProps) {
  return <InterviewAgent {...props} />;
}
