// Checks the interviewer's next turn in text, with no call (about 40 credits a run).
// Flags: --fixture pending-question|closing-es|closing-en, --case, --tier trial, --repeat N.
// Exit code 1 when a run fails. Never prints the key.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildInterviewerContext, type InterviewerContextInput } from "@/lib/ai/prompts/interviewer.agent";
import type { InterviewLanguage } from "@/lib/ai/postingLanguage";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import { checkNextTurn } from "@/lib/voice/admin";
import { continuityRecord } from "@/lib/voice/segments";
import { INTERVIEW_TIERS } from "@/lib/plans";

const { values: args } = parseArgs({
  options: {
    fixture: { type: "string" },
    case: { type: "string" },
    repeat: { type: "string" },
    tier: { type: "string" },
  },
});

type Check = { condition: string; passExample: string; failExample: string };
type Turn = { role: "agent" | "user"; message: string };

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
  cases: Record<string, Check & { extra: Turn[] }>;
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

  let variables: Record<string, string>;
  let history: Turn[];
  let check: Check;
  if ("cases" in fixture) {
    const chosen = args.case ?? "covered";
    const picked = fixture.cases[chosen];
    if (!picked) throw new Error(`--case must be one of ${Object.keys(fixture.cases).join(", ")}`);
    variables = buildInterviewerContext(base()).dynamicVariables;
    history = [{ role: "agent", message: variables.opening_line }, ...fixture.history, ...picked.extra];
    check = picked;
    console.log(`${name} / ${chosen} on the ${tier} agent (${seconds / 60} min): ${history.length} turns, then the interviewer's next one.\n`);
  } else {
    const record = continuityRecord(fixture.turns);
    variables = buildInterviewerContext(base({ remainingSeconds: fixture.plannedSeconds - fixture.droppedAfterSeconds, record }, fixture.plannedSeconds)).dynamicVariables;
    history = [
      { role: "agent", message: variables.opening_line },
      { role: "user", message: fixture.check.candidateReply },
    ];
    check = fixture.check;
    console.log(`The resumed call opens with: ${variables.opening_line}`);
    console.log(`The candidate replies: ${fixture.check.candidateReply}`);
    console.log(`Answered before the drop: ${record.exchanges.length} exchange(s). Pending: ${record.pending ?? "(none)"}\n`);
  }

  const runs = await checkNextTurn({
    agentId,
    name: `${fixture.company} ${name} check ${new Date().toISOString()}`,
    variables,
    history,
    condition: check.condition,
    passExample: check.passExample,
    failExample: check.failExample,
    repeat,
  });

  let credits = 0;
  for (const [index, run] of runs.entries()) {
    credits += run.credits ?? 0;
    console.log(`${run.passed ? "PASS" : "FAIL"}  run ${index + 1}: ${run.said || "(the interviewer said nothing)"}`);
    if (run.why) console.log(`      -> ${run.why}`);
  }
  const failed = runs.filter((run) => !run.passed).length;
  console.log(`\n${runs.length - failed} of ${runs.length} run(s) passed. Credits used: ${credits}.`);
  if (failed > 0 || runs.length === 0) process.exitCode = 1;
}

// The script smoke test loads this module to prove its imports resolve; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`voice:simulate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
