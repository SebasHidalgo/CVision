// Checks the interviewer's next turn in text, with no call (about 40 credits a run).
// Flags: --fixture pending-question|closing-es|closing-en, --case <name,name|all>, --tier trial, --repeat N, --llm <model>, --local, --list, --max-credits N (per run, default 150).
// --llm runs this checkout's definition on another model (the backup); --local runs it unsynced.
// Exit code 1 when a run fails. Never prints the key.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildInterviewerContext, type InterviewerContextInput } from "@/lib/ai/prompts/interviewer.agent";
import type { InterviewLanguage } from "@/lib/ai/postingLanguage";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import { agentConfigOverride, checkNextTurn, endToolIdFromWorkspace } from "@/lib/voice/admin";
import { decideEndTool, type EndToolReason } from "@/lib/voice/callEnd";
import { continuityRecord } from "@/lib/voice/segments";
import { halfText, ONE_TEXT, TWO_TEXT, UP_TEXT } from "@/lib/voice/timeNotes";
import { INTERVIEW_TIERS } from "@/lib/plans";

const { values: args } = parseArgs({
  options: {
    fixture: { type: "string" },
    case: { type: "string" },
    repeat: { type: "string" },
    tier: { type: "string" },
    llm: { type: "string" },
    local: { type: "boolean" },
    list: { type: "boolean" },
    "max-credits": { type: "string" },
  },
});

type Check = { condition: string; passExample: string; failExample: string; endTool?: "forbidden" | EndToolReason; silent?: boolean };
type Turn = { role: "agent" | "user"; message: string };
/** A fixture turn: spoken, one of the room's [time] lines by name, or an end_interview call with the room's answer (refused with this much paid time left, or allowed). */
type FixtureTurn = Turn | { role: "note"; note: "half" | "two" | "one" | "up" } | { role: "tool"; reason: EndToolReason; answer: "allowed" } | { role: "tool"; reason: EndToolReason; answer: "refused"; secondsLeft: number };

type Base = {
  candidateFirstName: string;
  role: string;
  company: string;
  language: InterviewLanguage;
  jobDescription: string;
  analysisSummary: string;
  requirements: Requirement[];
};

/** A resumed call: the record of the earlier call, and the candidate's reply to the greeting. */
type ResumeFixture = Base & {
  plannedSeconds: number;
  droppedAfterSeconds: number;
  turns: { role: string; message: string; time_in_call_secs: number }[];
  check: Check & { candidateReply: string };
};

/** A first call: the conversation so far, then one case's last turns and what the next turn must do. */
type CaseFixture = Base & {
  history: Turn[];
  cases: Record<string, Check & { extra: FixtureTurn[] }>;
};

const AGENT_ENV = { full: "ELEVENLABS_AGENT_ID", trial: "ELEVENLABS_TRIAL_AGENT_ID" } as const;
const FIXTURES = new Set(["pending-question", "closing-es", "closing-en"]);

async function main() {
  const tier = args.tier === "trial" ? "trial" : "full";
  const agentId = process.env[AGENT_ENV[tier]]?.trim();
  if (!agentId) throw new Error(`${AGENT_ENV[tier]} is not set (see .env.template)`);
  const repeat = args.repeat ? Number(args.repeat) : 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) throw new Error("--repeat must be a whole number from 1 to 10");
  const name = args.fixture ?? "pending-question";
  if (!FIXTURES.has(name)) throw new Error(`--fixture must be one of ${[...FIXTURES].join(", ")}`);
  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), `scripts/voice/fixtures/${name}.json`), "utf8")) as ResumeFixture | CaseFixture;
  const seconds = INTERVIEW_TIERS[tier === "trial" ? "TRIAL" : "FULL"].seconds;

  const base = (resume?: InterviewerContextInput["resume"], maxDurationSeconds = seconds): InterviewerContextInput => ({
    interviewId: "voice-simulate",
    candidateFirstName: fixture.candidateFirstName,
    role: fixture.role,
    company: fixture.company,
    jobDescription: fixture.jobDescription,
    analysisSummary: fixture.analysisSummary,
    requirements: fixture.requirements,
    maxDurationSeconds,
    language: fixture.language,
    ...(resume ? { resume } : {}),
  });

  // What one check sends: the session's variables, the conversation so far, and what the next turn must do.
  type History = Parameters<typeof checkNextTurn>[0]["history"];
  type Planned = { label: string; variables: Record<string, string>; history: History; check: Check };
  const planned: Planned[] = [];
  if ("cases" in fixture) {
    const chosen = args.case ?? "covered";
    const names = chosen === "all" ? Object.keys(fixture.cases) : chosen.split(",");
    const variables = buildInterviewerContext(base()).dynamicVariables;
    // A note turn becomes the line the room would send at that point of this tier's call.
    const noteText = { up: UP_TEXT, one: ONE_TEXT, two: TWO_TEXT, half: halfText(Math.floor(seconds / 120)) };
    if (args.list) {
      for (const [one, picked] of Object.entries(fixture.cases)) console.log(`${one.padEnd(14)} ${picked.endTool ?? "(words only)"}`);
      return;
    }
    for (const one of names) {
      const picked = fixture.cases[one];
      if (!picked) throw new Error(`--case must be all or one of ${Object.keys(fixture.cases).join(", ")}`);
      // The room's answer is the one the room's own code gives, on the lines it would have heard by then.
      const answer = (turn: Extract<FixtureTurn, { role: "tool" }>, before: Turn[]) =>
        turn.answer === "allowed"
          ? decideEndTool({ reason: "time_up", paidSecondsLeft: 0, turns: before }).result
          : decideEndTool({ reason: turn.reason === "candidate_confirmed" ? "candidate_confirmed" : "time_up", paidSecondsLeft: turn.secondsLeft, turns: before }).result;
      const heard: Turn[] = [{ role: "agent", message: variables.opening_line }, ...fixture.history];
      const extra: History = picked.extra.map((turn) => {
        if (turn.role === "note") return { role: "note" as const, message: noteText[turn.note] };
        if (turn.role === "tool") return { role: "tool" as const, reason: turn.reason, result: answer(turn, heard) };
        heard.push(turn);
        return turn;
      });
      planned.push({ label: `${name} / ${one}`, variables, history: [{ role: "agent", message: variables.opening_line }, ...fixture.history, ...extra], check: picked });
    }
  } else {
    const record = continuityRecord(fixture.turns);
    const variables = buildInterviewerContext(base({ remainingSeconds: fixture.plannedSeconds - fixture.droppedAfterSeconds, record }, fixture.plannedSeconds)).dynamicVariables;
    planned.push({ label: name, variables, history: [{ role: "agent", message: variables.opening_line }, { role: "user", message: fixture.check.candidateReply }], check: fixture.check });
    console.log(`The resumed call opens with: ${variables.opening_line}`);
    console.log(`The candidate replies: ${fixture.check.candidateReply}`);
    console.log(`Answered before the drop: ${record.exchanges.length} exchange(s). Pending: ${record.pending ?? "(none)"}\n`);
  }

  // The synced agent as it is, or this checkout's definition for this run only.
  const endToolId = args.llm || args.local ? await endToolIdFromWorkspace() : null;
  if ((args.llm || args.local) && !endToolId) throw new Error("the workspace has no end_interview tool yet: run npm run agent:sync first");
  const configOverride = args.llm || args.local ? agentConfigOverride(tier === "trial" ? "TRIAL" : "FULL", { ...(args.llm ? { llm: args.llm } : {}), endToolId }) : undefined;
  const running = configOverride ? `this checkout's definition${args.llm ? ` on ${args.llm}` : ""}` : "the synced agent";

  let credits = 0;
  let failed = 0;
  let total = 0;
  for (const one of planned) {
    console.log(`${one.label} on the ${tier} agent (${seconds / 60} min, ${running}): ${one.history.length} turns, then the interviewer's next one.`);
    const runs = await checkNextTurn({
      agentId,
      name: `${fixture.company} ${one.label} check ${new Date().toISOString()}`,
      variables: one.variables,
      history: one.history,
      condition: one.check.condition,
      passExample: one.check.passExample,
      failExample: one.check.failExample,
      repeat,
      ...(one.check.endTool ? { endTool: one.check.endTool } : {}),
      ...(one.check.silent ? { mustBeSilent: true } : {}),
      ...(args["max-credits"] ? { maxCredits: Number(args["max-credits"]) } : {}),
      ...(configOverride ? { configOverride } : {}),
    });
    for (const [index, run] of runs.entries()) {
      credits += run.credits ?? 0;
      total += 1;
      if (!run.passed) failed += 1;
      // One line per reply: a reply's later paragraphs must survive a grep.
      console.log(`${run.passed ? "PASS" : "FAIL"}  run ${index + 1} [${run.model ?? "model?"}, end_interview: ${run.endedCall ? (run.endReason ?? "no reason") : "no"}]: ${run.said.replace(/\s+/g, " ") || "(the interviewer said nothing)"}`);
      if (run.why) console.log(`      -> ${run.why}`);
    }
    if (runs.length === 0) failed += 1;
    console.log("");
  }
  console.log(`${total - failed} of ${total} run(s) passed. Credits used: ${credits}.`);
  if (failed > 0 || total === 0) process.exitCode = 1;
}

// The script smoke test loads this module to prove its imports resolve; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`voice:simulate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
