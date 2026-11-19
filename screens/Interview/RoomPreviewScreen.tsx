import { readFileSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { fontText } from "@/components/design-system/fonts";
import ClientMessages from "@/components/i18n/ClientMessages";
import type { TranscriptLine } from "@/components/interview/room/RoomTranscript";
import { CATALOG, CATALOG_CURRENCY } from "@/lib/billing/catalog";
import { devToolsAllowed } from "@/lib/devTools";
import { formatMoney } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { AGENT_SECONDS } from "@/lib/interviewEntitlement";
import { MAX_INTERVIEW_STARTS } from "@/lib/interviewLimits";
import { INTERVIEW_PACK_CREDITS, PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import InterviewRoomLoader from "./components/InterviewRoomLoader";
import { isPreviewState, livePreview, previewProps } from "./utils/previewStates";

type Localized<T> = Record<"en" | "es", T>;
type PreviewFixture = { role: Localized<string>; company: string; candidate: Localized<string>; turns: Localized<TranscriptLine[]> } & Localized<TranscriptLine[]>;

const PREVIEW_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Dev only: the room in any state, with an invented call (e2e/fixtures/room-transcript.json), through the real
 * InterviewAgent, which never calls the platform or the server in a preview. 404 without dev tools.
 *
 * No state: the live room with 24 lines (?drip=1 drips them, ?closing=1 is past the paid time). `?state=` one of
 * utils/previewStates.ts: ready, trial, credit, held, mic-denied; microphone, connecting, queued; waiting, speaking,
 * your-turn, turns (scripted: a pause between two sentences, the hold, the answer, an interruption), last-minute,
 * closing, goodbye, ending; early-end, dropped, dropped-no-time, silent-drop; cap, voice-down, needs-pro,
 * needs-pro-had-voice, paused, needs-pack, past-due; purchase-waiting, confirming, stalled. An unknown state is a 404.
 */
export default async function RoomPreviewScreen({ state, drip = false, closing = false }: { state?: string; drip?: boolean; closing?: boolean }) {
  if (!devToolsAllowed()) notFound();
  if (state !== undefined && !isPreviewState(state)) notFound();
  const locale = await getLocale();
  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "e2e/fixtures/room-transcript.json"), "utf8")) as PreviewFixture;
  const lines = { calls: fixture[locale], turns: fixture.turns[locale] };
  const seconds = { fullSeconds: AGENT_SECONDS.main, trialSeconds: AGENT_SECONDS.trial };
  const props = state ? previewProps(state, lines, seconds) : livePreview(lines, { drip, closing, ...seconds });
  const price = (key: keyof typeof CATALOG) => formatMoney(Number(CATALOG[key].amountMinor) / 100, CATALOG_CURRENCY, locale);
  return (
    <ClientMessages ns={["interview", "billing"]}>
      <div className={cn("ed-root flex flex-1 flex-col", fontText.variable)}>
        <InterviewRoomLoader
          interviewId={PREVIEW_ID}
          role={fixture.role[locale]}
          company={fixture.company}
          candidateName={fixture.candidate[locale]}
          analysisId={PREVIEW_ID}
          attemptNumber={2}
          maxStarts={MAX_INTERVIEW_STARTS}
          language={locale}
          offer={{
            prices: { pro: price("pro_monthly"), pack: price("interview_pack") },
            proInterviewsPerMonth: PLANS.PRO.interviewsPerMonth,
            fullMinutes: AGENT_SECONDS.main / 60,
            packCredits: INTERVIEW_PACK_CREDITS,
            periodLimit: PLANS.PRO.interviewsPerMonth,
          }}
          {...props}
        />
      </div>
    </ClientMessages>
  );
}
