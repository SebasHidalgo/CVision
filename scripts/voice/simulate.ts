// Checks in text, with no call, that a resumed interviewer asks the pending question first (about 40 credits a run).
// Usage: npm run voice:simulate [-- --repeat 3] [--tier trial]. Exit code 1 when a run fails. Never prints the key.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildInterviewerContext } from "@/lib/ai/prompts/interviewer.agent";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import { checkNextTurn } from "@/lib/voice/admin";
import { continuityRecord } from "@/lib/voice/segments";

const { values: args } = parseArgs({
  options: {
    repeat: { type: "string" },
    tier: { type: "string" },
  },
});

type Fixture = {
  candidateFirstName: string;
  role: string;
  company: string;
  language: "en" | "es";
  plannedSeconds: number;
  droppedAfterSeconds: number;
  jobDescription: string;
  analysisSummary: string;
  requirements: Requirement[];
  turns: { role: string; message: string; time_in_call_secs: number }[];
  check: { candidateReply: string; condition: string; passExample: string; failExample: string };
};

const AGENT_ENV = { full: "ELEVENLABS_AGENT_ID", trial: "ELEVENLABS_TRIAL_AGENT_ID" } as const;

async function main() {
  const tier = args.tier === "trial" ? "trial" : "full";
  const agentId = process.env[AGENT_ENV[tier]]?.trim();
  if (!agentId) throw new Error(`${AGENT_ENV[tier]} is not set (see .env.template)`);
  const repeat = args.repeat ? Number(args.repeat) : 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) throw new Error("--repeat must be a whole number from 1 to 10");

  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "scripts/voice/fixtures/pending-question.json"), "utf8")) as Fixture;
  const record = continuityRecord(fixture.turns);
  const { dynamicVariables } = buildInterviewerContext({
    interviewId: "voice-simulate",
    candidateFirstName: fixture.candidateFirstName,
    role: fixture.role,
    company: fixture.company,
    jobDescription: fixture.jobDescription,
    analysisSummary: fixture.analysisSummary,
    requirements: fixture.requirements,
    maxDurationSeconds: fixture.plannedSeconds,
    language: fixture.language,
    resume: { remainingSeconds: fixture.plannedSeconds - fixture.droppedAfterSeconds, record },
  });

  console.log(`The resumed call opens with: ${dynamicVariables.opening_line}`);
  console.log(`The candidate replies: ${fixture.check.candidateReply}`);
  console.log(`Answered before the drop: ${record.exchanges.length} exchange(s). Pending: ${record.pending ?? "(none)"}\n`);

  const runs = await checkNextTurn({
    agentId,
    name: `${dynamicVariables.company} resumed-call check ${new Date().toISOString()}`,
    variables: dynamicVariables,
    history: [
      { role: "agent", message: dynamicVariables.opening_line },
      { role: "user", message: fixture.check.candidateReply },
    ],
    condition: fixture.check.condition,
    passExample: fixture.check.passExample,
    failExample: fixture.check.failExample,
    repeat,
  });

  let credits = 0;
  for (const [index, run] of runs.entries()) {
    credits += run.credits ?? 0;
    console.log(`${run.passed ? "PASS" : "FAIL"}  run ${index + 1}: ${run.said || "(the interviewer said nothing)"}`);
    if (run.why) console.log(`      -> ${run.why}`);
  }
  const failed = runs.filter((run) => !run.passed).length;
  console.log(`\n${runs.length - failed} of ${runs.length} run(s) asked the pending question first. Credits used: ${credits}.`);
  if (failed > 0 || runs.length === 0) process.exitCode = 1;
}

// The script smoke test loads this module to prove its imports resolve; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`voice:simulate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
