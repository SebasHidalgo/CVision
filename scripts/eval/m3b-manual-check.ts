/**
 * M3-B manual check (Step 8). Seeds one synthetic analysis + interview in the
 * owner's account (labeled "[M3-B check]"), then sends a signed post-call
 * webhook for it to a running dev server started with the given secret, and
 * waits for after() to generate the feedback. Prints the resulting row.
 *
 *   ELEVENLABS_WEBHOOK_SECRET=<same as the dev server> npx tsx --conditions=react-server --env-file-if-exists=.env scripts/eval/m3b-manual-check.ts [--cleanup]
 *
 * --cleanup deletes the seeded rows instead (analysis cascades to feedback;
 * interview is set null on the analysis side, so it is deleted explicitly).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { signWebhookPayload } from "@/lib/elevenlabs/webhookSignature";
import { resumeFeedbackSchema } from "@/lib/schemas/resumeSchema";

const LABEL = "[M3-B check]";
const CONVERSATION_ID = "conv_m3b_manual_check";
const prisma = new PrismaClient();

async function main() {
  const cleanup = process.argv.includes("--cleanup");
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  if (!cleanup && !secret) throw new Error("ELEVENLABS_WEBHOOK_SECRET is required");

  const owner = await prisma.interview.findFirst({ select: { userId: true } });
  if (!owner) throw new Error("no interview rows to take the owner id from");

  if (cleanup) {
    const seeded = await prisma.resumeAnalysis.findMany({ where: { companyName: { contains: LABEL } }, select: { id: true, interviews: { select: { id: true } } } });
    for (const row of seeded) {
      for (const interview of row.interviews) await prisma.interview.delete({ where: { id: interview.id } });
      await prisma.resumeAnalysis.delete({ where: { id: row.id } });
    }
    console.log(`deleted ${seeded.length} seeded analysis row(s) and their interviews`);
    return;
  }

  const fixtureDir = path.join(__dirname, "fixtures-interview", "addresses-every-gap");
  const fixture = JSON.parse(readFileSync(path.join(fixtureDir, "fixture.json"), "utf8"));
  const transcript = JSON.parse(readFileSync(path.join(fixtureDir, "transcript.json"), "utf8"));
  const ctx = fixture.context;

  // A feedback row that satisfies the full analysis schema, so the analyses
  // list and the detail page read it like any other.
  const feedback = resumeFeedbackSchema.parse({
    overall: { qualityScore: 68, summaryText: ctx.analysisSummary, prioritizedFixes: [{ title: "Add Kubernetes work", impact: "High", action: "Describe the cluster migration with figures." }] },
    atsCompatibility: { description: "Synthetic check row: the text layer is clean, with standard section headings and no encoding artifacts to report.", encodingArtifacts: [], sectionsDetected: ["Experience", "Skills"], problems: ["Synthetic row"], fixes: ["Synthetic row"], evidence: [] },
    experienceAndImpact: { score: 70, description: "Synthetic check row: experience bullets name services and one measured outcome, written as outcomes rather than duties.", quantifiedAchievements: [], strengths: ["Synthetic row"], weaknesses: ["Synthetic row"], suggestedBullets: [] },
    skills: { score: 66, description: "Synthetic check row: skills are grouped and the main ones are backed by bullets in the experience section.", matchedSkills: [{ name: "Node.js", evidence: "Node.js services" }, { name: "PostgreSQL", evidence: "PostgreSQL" }], actionPlan: ["Synthetic row"] },
    educationAndCertifications: { score: 60, description: "Synthetic check row: a relevant degree is listed with its year and no certifications.", highlights: ["Synthetic row"], improvements: [], recommendedCerts: [] },
    toneAndClarity: { description: "Synthetic check row: short bullets in a consistent voice, with no passive constructions to speak of.", suggestions: ["Synthetic row"] },
    jobFit: { description: "Synthetic check row: the posting's required items are met except Kubernetes operation and on-call; GraphQL is the one preferred item and it is missing.", requirements: ctx.requirements, strategicRecommendations: ["Synthetic row"] },
  });

  const toJson = (value: unknown) => value as Prisma.InputJsonValue;
  const analysis = await prisma.resumeAnalysis.create({
    data: {
      companyName: `${ctx.company} ${LABEL}`,
      jobTitle: ctx.role,
      jobDescription: ctx.jobDescription,
      resumeKey: "cv/synthetic/00000000-0000-4000-8000-000000000000.pdf",
      userId: owner.userId,
      feedback: {
        create: {
          overall: toJson(feedback.overall),
          atsCompatibility: toJson(feedback.atsCompatibility),
          experienceAndImpact: toJson(feedback.experienceAndImpact),
          skills: toJson(feedback.skills),
          educationAndCertifications: toJson(feedback.educationAndCertifications),
          toneAndClarity: toJson(feedback.toneAndClarity),
          jobFit: toJson(feedback.jobFit),
        },
      },
    },
  });

  // What the session endpoint would have written had the token been issued.
  const interview = await prisma.interview.create({
    data: {
      role: ctx.role,
      techstack: ["Node.js", "PostgreSQL"],
      userId: owner.userId,
      resumeAnalysisId: analysis.id,
      status: "IN_PROGRESS",
      startCount: 1,
      startedAt: new Date(),
      conversationId: CONVERSATION_ID,
      issuedContext: toJson({ interview_id: "pending", candidate_name: "Sebas", language_name: "English" }),
    },
  });
  await prisma.interview.update({ where: { id: interview.id }, data: { issuedContext: toJson({ interview_id: interview.id, candidate_name: "Sebas", language_name: "English" }) } });
  console.log(`seeded analysis ${analysis.id} and interview ${interview.id} (IN_PROGRESS, conversation ${CONVERSATION_ID})`);

  const now = Math.floor(Date.now() / 1000);
  const event = JSON.stringify({
    type: "post_call_transcription",
    event_timestamp: now,
    data: {
      agent_id: "agent_synthetic",
      conversation_id: CONVERSATION_ID,
      status: "done",
      transcript,
      metadata: { start_time_unix_secs: now - fixture.durationSeconds, call_duration_secs: fixture.durationSeconds },
      conversation_initiation_client_data: { dynamic_variables: { interview_id: interview.id, candidate_name: "Sebas", language_name: "English" } },
    },
  });

  const response = await fetch("http://localhost:3000/api/webhooks/elevenlabs", {
    method: "POST",
    headers: { "content-type": "application/json", "ElevenLabs-Signature": signWebhookPayload(event, secret!) },
    body: event,
  });
  console.log(`webhook -> ${response.status} ${await response.text()}`);

  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const row = await prisma.interview.findUnique({
      where: { id: interview.id },
      select: { status: true, failureReason: true, feedbackAttempts: true, transcriptSource: true, contextMismatch: true, durationSeconds: true, InterviewFeedback: { select: { totalScore: true, report: true } } },
    });
    if (!row) throw new Error("row vanished");
    if (row.status === "COMPLETED" || row.status === "FAILED") {
      const report = row.InterviewFeedback?.report as { gapFollowThrough?: { requirement: string; outcome: string; quote: string }[] } | null;
      console.log(`after ${(i + 1) * 2}s: status=${row.status} reason=${row.failureReason} attempts=${row.feedbackAttempts} source=${row.transcriptSource} mismatch=${row.contextMismatch} duration=${row.durationSeconds} total=${row.InterviewFeedback?.totalScore}`);
      for (const gap of report?.gapFollowThrough ?? []) console.log(`  gap [${gap.outcome}] ${gap.requirement.slice(0, 60)} quote="${gap.quote.slice(0, 70)}"`);
      console.log(`feedback page: http://localhost:3000/interview/${interview.id}/feedback`);
      return;
    }
    if (i % 5 === 4) console.log(`...${(i + 1) * 2}s status=${row.status}`);
  }
  console.log("timed out waiting for feedback");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
