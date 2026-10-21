import { describe, expect, it } from "vitest";
import type { TranscriptTurn } from "@/lib/elevenlabs/postCall";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import {
  candidateText,
  checkInterviewFeedback,
  countInterviewChecks,
  guardInterviewFeedback,
} from "./interviewGuardrails";
import { FEEDBACK_CATEGORIES, type AiFeedback } from "./schemas";

const TURNS: TranscriptTurn[] = [
  { role: "agent", message: "Tell me about GraphQL.", time_in_call_secs: 0 },
  { role: "user", message: "Um, I have seen GraphQL around, mostly in demos. I did build a REST API at Northwind.", time_in_call_secs: 4 },
  { role: "agent", message: "And Terraform?", time_in_call_secs: 30 },
  { role: "user", message: "Not Terraform, no, but I wrote the Docker setup for three services.", time_in_call_secs: 34 },
];

const GAPS: Requirement[] = [
  { requirement: "GraphQL schema design", kind: "required", status: "missing", evidence: "", note: "" },
  { requirement: "Terraform", kind: "preferred", status: "missing", evidence: "", note: "" },
];

const categories = (comment = "Specific where it counted.") =>
  FEEDBACK_CATEGORIES.map((name) => ({ name, score: 60, comment }));

const feedback = (overrides: Partial<AiFeedback> = {}): AiFeedback => ({
  gapFollowThrough: [
    { requirement: "GraphQL schema design", outcome: "dodged", quote: "I have seen GraphQL around, mostly in demos.", note: "Demos only." },
    { requirement: "Terraform", outcome: "dodged", quote: "Not Terraform, no", note: "Named Docker instead." },
  ],
  notableAnswers: [
    { quote: "I did build a REST API at Northwind.", worked: true, why: "A concrete thing they built." },
  ],
  categoryScores: categories(),
  strengths: [{ point: "Names concrete work", anchor: { source: "notableAnswers", index: 0 } }],
  areasForImprovement: [{ point: "Bring an example for GraphQL", anchor: { source: "gapFollowThrough", index: 0 } }],
  finalAssessment: "Short and general.",
  ...overrides,
});

const input = (fb: AiFeedback) => ({
  candidateText: candidateText(TURNS),
  allowedText: TURNS.map((t) => t.message).join("\n") + "\nPosting: 5 years, GraphQL, Terraform, AWS.",
  gaps: GAPS,
  feedback: fb,
});

describe("checkInterviewFeedback", () => {
  it("is clean for a feedback whose quotes, anchors and gap rows all hold", () => {
    expect(checkInterviewFeedback(input(feedback()))).toEqual([]);
  });

  it("grounds quotes against the candidate turns only", () => {
    const violations = checkInterviewFeedback(
      input(
        feedback({
          notableAnswers: [
            { quote: "Tell me about GraphQL.", worked: true, why: "" }, // the interviewer said this
            { quote: "i have seen graphql around, mostly in demos", worked: false, why: "" }, // case only
            { quote: "I built a REST API at Northwind and I wrote the Docker setup", worked: true, why: "" }, // stitched
          ],
        }),
      ),
    );

    const grounding = violations.filter((v) => v.check === "evidence-grounding");
    expect(grounding.map((v) => [v.path, v.kind])).toEqual([
      ["notableAnswers[0].quote", "not-found"],
      ["notableAnswers[1].quote", "case-or-punctuation"],
      ["notableAnswers[2].quote", "altered"],
    ]);
  });

  it("reports an anchor that points at nothing", () => {
    const violations = checkInterviewFeedback(
      input(feedback({ strengths: [{ point: "x", anchor: { source: "notableAnswers", index: 3 } }] })),
    );
    expect(violations).toEqual([
      expect.objectContaining({ check: "anchor-invalid", path: "strengths[0].anchor", value: "notableAnswers[3]" }),
    ]);
  });

  it("reports a gap with no row, a row for no gap, and a duplicate row", () => {
    const violations = checkInterviewFeedback(
      input(
        feedback({
          gapFollowThrough: [
            { requirement: "GraphQL schema design", outcome: "dodged", quote: "", note: "" },
            { requirement: "graphql schema design", outcome: "partially", quote: "", note: "" },
            { requirement: "Kubernetes", outcome: "not_raised", quote: "", note: "" },
          ],
        }),
      ),
    );
    const coverage = violations.filter((v) => v.check === "gap-coverage");
    expect(coverage.map((v) => v.note)).toEqual(["second row for gap 1", "no row for gap 2", "row for no listed gap"]);
  });

  it("names a drifted gap name once, with the issued text, when the rows are the gaps by position", () => {
    // Two gaps, two rows, the second row's text drifted past the loose match.
    const violations = checkInterviewFeedback(
      input(
        feedback({
          gapFollowThrough: [
            { requirement: "GraphQL schema design", outcome: "dodged", quote: "", note: "" },
            { requirement: "IaC tooling", outcome: "dodged", quote: "", note: "" },
          ],
        }),
      ),
    );
    const coverage = violations.filter((v) => v.check === "gap-coverage");
    expect(coverage).toEqual([
      {
        check: "gap-coverage",
        path: "gapFollowThrough[1].requirement",
        value: "IaC tooling",
        note: "name differs from gap 2; repaired by position",
        replacement: "Terraform",
      },
    ]);
  });

  it("does not repair by position when the counts differ or the positions do not line up", () => {
    // Three rows for two gaps: the counts differ.
    const extra = checkInterviewFeedback(
      input(
        feedback({
          gapFollowThrough: [
            { requirement: "GraphQL schema design", outcome: "dodged", quote: "", note: "" },
            { requirement: "IaC tooling", outcome: "dodged", quote: "", note: "" },
            { requirement: "Kubernetes", outcome: "not_raised", quote: "", note: "" },
          ],
        }),
      ),
    ).filter((v) => v.check === "gap-coverage");
    expect(extra.map((v) => v.note)).toEqual(["no row for gap 2", "row for no listed gap", "row for no listed gap"]);
    expect(extra.every((v) => v.replacement === undefined)).toBe(true);

    // Two rows for two gaps, but the drifted row sits where the matched gap is.
    const swapped = checkInterviewFeedback(
      input(
        feedback({
          gapFollowThrough: [
            { requirement: "IaC tooling", outcome: "dodged", quote: "", note: "" },
            { requirement: "GraphQL schema design", outcome: "dodged", quote: "", note: "" },
          ],
        }),
      ),
    ).filter((v) => v.check === "gap-coverage");
    expect(swapped.map((v) => v.note)).toEqual(["no row for gap 2", "row for no listed gap"]);
  });

  it("lets a rounding of a measured stat through, and a quantity word in prose", () => {
    const stats = {
      totalTurns: 9,
      candidateTurns: 4,
      candidateWords: 398,
      averageCandidateTurnWords: 99.5,
      candidateOnFloorSeconds: 412,
      longestTurnGapSeconds: 31,
      durationSeconds: 540,
      short: false,
    };
    const violations = checkInterviewFeedback({
      ...input(
        feedback({
          categoryScores: categories("About 400 words over nine answers, roughly 7 minutes on the floor; zero hands-on experience with Terraform."),
          notableAnswers: [{ quote: "I did build a REST API at Northwind.", worked: true, why: "Dozens of endpoints, they said." }],
        }),
      ),
      stats,
    });
    // 400 is within 2% of 398 and 7 of 412/60; "zero" and "dozens" are prose, not quotes.
    expect(violations.filter((v) => v.check === "fabricated-number")).toEqual([]);
  });

  it("still reports a number outside the rounding tolerance, and a quantity word inside a quote", () => {
    const violations = checkInterviewFeedback({
      ...input(
        feedback({
          categoryScores: categories("Around 450 words in total."),
          notableAnswers: [{ quote: "I did build a REST API at Northwind.", worked: true, why: "" }],
          gapFollowThrough: [
            { requirement: "GraphQL schema design", outcome: "dodged", quote: "I have seen GraphQL around, mostly in demos.", note: "" },
            { requirement: "Terraform", outcome: "dodged", quote: "dozens of Terraform modules", note: "" },
          ],
        }),
      ),
      stats: { totalTurns: 9, candidateTurns: 4, candidateWords: 398, averageCandidateTurnWords: 99.5, candidateOnFloorSeconds: 412, longestTurnGapSeconds: 31, durationSeconds: 540, short: false },
    });
    const numbers = violations.filter((v) => v.check === "fabricated-number").map((v) => `${v.path}:${v.value}`);
    expect(numbers).toEqual(expect.arrayContaining(["categoryScores[0].comment:450", "gapFollowThrough[1].quote:dozens"]));
  });

  it("reports numbers and technology names that neither speaker nor the posting said", () => {
    const violations = checkInterviewFeedback(
      input(
        feedback({
          categoryScores: categories("Mentioned 3 services and Docker; a stronger answer would cite Kubernetes and 99.9% uptime."),
        }),
      ),
    );
    const fabricated = violations.filter((v) => v.check !== "evidence-grounding");
    // "3" is only in the transcript as "three", so the digit is reported;
    // Docker is in the transcript; Kubernetes and 99.9 are in neither.
    expect(fabricated.map((v) => `${v.check}:${v.value}`)).toEqual(
      expect.arrayContaining(["fabricated-number:3", "fabricated-number:99.9", "fabricated-term:Kubernetes"]),
    );
    expect(fabricated.map((v) => v.value)).not.toContain("Docker");
  });
});

describe("guardInterviewFeedback", () => {
  it("restores a drifted gap name from the issued text and records it as one repair", () => {
    const { feedback: cleaned, guard } = guardInterviewFeedback(
      input(
        feedback({
          gapFollowThrough: [
            { requirement: "GraphQL schema design", outcome: "dodged", quote: "I have seen GraphQL around, mostly in demos.", note: "Demos only." },
            { requirement: "IaC tooling", outcome: "dodged", quote: "Not Terraform, no", note: "Named Docker instead." },
          ],
        }),
      ),
    );

    expect(cleaned.gapFollowThrough.map((row) => row.requirement)).toEqual(["GraphQL schema design", "Terraform"]);
    // The row's verdict and evidence are the model's; only the name was restored.
    expect(cleaned.gapFollowThrough[1]).toMatchObject({ outcome: "dodged", quote: "Not Terraform, no" });
    expect(guard.interventions).toEqual([
      {
        check: "gap-coverage",
        action: "gap-name-repaired",
        path: "gapFollowThrough[1].requirement",
        value: "IaC tooling",
        replacement: "Terraform",
      },
    ]);
    expect(guard.counts["gap-name-repaired"]).toBe(1);
    expect(guard.counts.recorded).toBe(0);
    expect(guard.violations.filter((v) => v.check === "gap-coverage")).toHaveLength(1);
  });

  it("drops an unfound quote, normalizes a case-only one, and keeps the rows", () => {
    const { feedback: cleaned, guard } = guardInterviewFeedback(
      input(
        feedback({
          gapFollowThrough: [
            { requirement: "GraphQL schema design", outcome: "dodged", quote: "I know GraphQL deeply", note: "n" },
            { requirement: "Terraform", outcome: "dodged", quote: "not terraform, no", note: "n" },
          ],
        }),
      ),
    );

    expect(cleaned.gapFollowThrough[0].quote).toBe("");
    expect(cleaned.gapFollowThrough[0].outcome).toBe("dodged");
    expect(cleaned.gapFollowThrough[1].quote).toBe("Not Terraform, no");
    expect(guard.counts).toEqual({ "quote-dropped": 1, "quote-normalized": 1, "item-dropped": 0, "gap-name-repaired": 0, recorded: 0 });
    // The measurement is untouched by the edit.
    expect(guard.violations).toHaveLength(2);
  });

  it("drops a strength whose anchor points at nothing, and records the rest", () => {
    const { feedback: cleaned, guard } = guardInterviewFeedback(
      input(
        feedback({
          strengths: [
            { point: "Keep", anchor: { source: "notableAnswers", index: 0 } },
            { point: "Drop", anchor: { source: "gapFollowThrough", index: 9 } },
          ],
          finalAssessment: "Would benefit from Kubernetes.",
        }),
      ),
    );

    expect(cleaned.strengths.map((s) => s.point)).toEqual(["Keep"]);
    expect(cleaned.finalAssessment).toBe("Would benefit from Kubernetes.");
    expect(guard.counts["item-dropped"]).toBe(1);
    expect(guard.counts.recorded).toBe(1);
    expect(countInterviewChecks(guard.violations)).toMatchObject({ "anchor-invalid": 1, "fabricated-term": 1 });
  });

  it("does not mutate the model's answer", () => {
    const original = feedback({ notableAnswers: [{ quote: "invented", worked: true, why: "" }] });
    const snapshot = structuredClone(original);

    guardInterviewFeedback(input(original));

    expect(original).toEqual(snapshot);
  });
});
