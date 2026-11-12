import { readFileSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import ClientMessages from "@/components/i18n/ClientMessages";
import { devToolsAllowed } from "@/lib/devTools";
import { getLocale } from "@/lib/i18n/server";
import { AGENT_SECONDS } from "@/lib/interviewEntitlement";
import { MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { INTERVIEW_PACK_CREDITS, PLANS } from "@/lib/plans";
import InterviewRoomLoader from "./components/InterviewRoomLoader";
import type { TranscriptLine } from "./components/Transcript";

type PreviewFixture = { role: Record<"en" | "es", string>; company: string } & Record<"en" | "es", TranscriptLine[]>;

/** Dev only: the live room with an invented 24-line call (?drip=1 drips it); 404 without dev tools. */
export default async function RoomPreviewScreen({ drip = false }: { drip?: boolean }) {
  if (!devToolsAllowed()) notFound();
  const locale = await getLocale();
  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "e2e/fixtures/room-transcript.json"), "utf8")) as PreviewFixture;
  return (
    <ClientMessages ns={["interview", "billing"]}>
      <InterviewRoomLoader
        interviewId="00000000-0000-4000-8000-000000000000"
        role={fixture.role[locale]}
        company={fixture.company}
        candidateName={null}
        analysisId="00000000-0000-4000-8000-000000000000"
        attemptNumber={1}
        startCount={1}
        maxStarts={MAX_INTERVIEW_STARTS}
        maxDurationSeconds={AGENT_SECONDS.main}
        language={locale}
        resume={null}
        entry={{ kind: "continue" }}
        counts={null}
        offer={{ prices: { pro: "", pack: "" }, proInterviewsPerMonth: PLANS.PRO.interviewsPerMonth, fullMinutes: AGENT_SECONDS.main / 60, packCredits: INTERVIEW_PACK_CREDITS, periodLimit: PLANS.PRO.interviewsPerMonth }}
        preview={drip ? { lines: fixture[locale].slice(0, 6), later: fixture[locale].slice(6), everyMs: 1_500 } : { lines: fixture[locale] }}
      />
    </ClientMessages>
  );
}
