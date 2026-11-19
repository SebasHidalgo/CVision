"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CAP, TICK } from "@/components/interview/ui";
import { cn } from "@/lib/utils";
import type { InterviewAgentProps } from "./InterviewAgent";

/** What shows while the room's chunk loads. */
function RoomLoading() {
  const { t } = useTranslation("interview");
  return (
    <div className="flex flex-1 flex-col">
      <div className="ed-wrap flex w-full flex-1 flex-col pt-4 sm:pt-6">
        <header className="border-b border-ed-line pb-4 lg:pb-5">
          <p className={cn(CAP, TICK, "text-ed-ink-2")}>{t("room.title")}</p>
        </header>
        <p role="status" className="mt-8 flex items-center gap-3 text-ed-body text-ed-ink-2">
          <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
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
