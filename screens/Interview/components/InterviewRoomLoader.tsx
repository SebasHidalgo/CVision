"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import Eyebrow from "@/components/layout/Eyebrow";
import type { InterviewAgentProps } from "./InterviewAgent";

/** What shows while the room's chunk loads. */
function RoomLoading() {
  const { t } = useTranslation("interview");
  return (
    <div className="flex flex-1 flex-col">
      <div className="wrap flex flex-1 flex-col py-8 lg:py-10">
        <header className="border-b border-line pb-6">
          <Eyebrow tick>{t("room.title")}</Eyebrow>
        </header>
        <p role="status" className="mt-10 flex items-center gap-3 text-sm text-ink-2">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {t("room.loading")}
        </p>
      </div>
    </div>
  );
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
