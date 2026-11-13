import { describe, expect, it } from "vitest";
import { MAX_JOB_DESCRIPTION_CHARS, type Requirement } from "@/lib/schemas/resumeSchema";
import {
  buildInterviewerContext,
  INTERVIEWER_AGENT_PROMPT,
  INTERVIEWER_CONTEXT_BUDGET_BYTES,
  INTERVIEWER_FIRST_MESSAGE,
  INTERVIEWER_VARIABLE_NAMES,
  interviewerContextBytes,
  MAX_CONTEXT_REQUIREMENTS,
  requirementGaps,
  templatePlaceholders,
  type InterviewerContextInput,
} from "./interviewer.agent";

const requirement = (overrides: Partial<Requirement>): Requirement => ({
  requirement: "React",
  kind: "required",
  status: "met",
  evidence: "Led the checkout rewrite in React",
  note: "Shown in the resume.",
  ...overrides,
});

const input = (
  requirements: Requirement[],
  overrides: Partial<InterviewerContextInput> = {},
): InterviewerContextInput => ({
  interviewId: "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c",
  candidateFirstName: "Ana",
  role: "Frontend Engineer",
  company: "Northwind",
  jobDescription:
    "We are looking for a frontend engineer to join our team and own the checkout flow. You will work with React and TypeScript.",
  analysisSummary: "The resume meets the required qualifications and shows one preferred one.",
  requirements,
  maxDurationSeconds: 720,
  ...overrides,
});

const MIXED: Requirement[] = [
  requirement({ requirement: "React and TypeScript", status: "met" }),
  requirement({ requirement: "Payments experience", kind: "preferred", status: "missing", evidence: "", note: "Nothing about payments." }),
  requirement({ requirement: "Fluency in English", status: "met", evidence: "English: fluent" }),
  requirement({ requirement: "Node.js services", status: "partial", evidence: "Built one Express service", note: "Only one small service." }),
];

describe("buildInterviewerContext: the gaps", () => {
  it("lists exactly the partial and missing requirements, in the analysis order, and the met ones apart", () => {
    const gaps = requirementGaps(MIXED);
    expect(gaps.map((r) => r.requirement)).toEqual(["Payments experience", "Node.js services"]);

    const { dynamicVariables } = buildInterviewerContext(input(MIXED));

    expect(dynamicVariables.requirements_gaps).toBe(
      [
        "- [preferred, missing] Payments experience — note: Nothing about payments.",
        '- [required, partial] Node.js services — note: Only one small service. — resume says: "Built one Express service"',
      ].join("\n"),
    );
    expect(dynamicVariables.requirements_gaps).not.toContain("React and TypeScript");

    expect(dynamicVariables.requirements_met).toContain("- [required, met] React and TypeScript");
    expect(dynamicVariables.requirements_met).toContain('resume says: "English: fluent"');
    expect(dynamicVariables.requirements_met).not.toContain("Payments");
  });

  it("writes (none) rather than an empty list", () => {
    const { dynamicVariables } = buildInterviewerContext(input([]));

    expect(dynamicVariables.requirements_gaps).toBe("(none)");
    expect(dynamicVariables.requirements_met).toBe("(none)");
    expect(dynamicVariables.requirements_not_evident).toBe("(none)");
  });
});

describe("buildInterviewerContext: what the resume cannot show", () => {
  const notShown = requirement({ requirement: "Pass a background check", status: "not_evident", evidence: "", note: "" });

  it("lists not_evident requirements apart from the gaps, never counted as one", () => {
    const { dynamicVariables } = buildInterviewerContext(input([...MIXED, notShown]));

    expect(requirementGaps([...MIXED, notShown]).map((r) => r.requirement)).not.toContain("Pass a background check");
    expect(dynamicVariables.requirements_not_evident).toBe("- [required, not_evident] Pass a background check");
    expect(dynamicVariables.requirements_gaps).not.toContain("background check");
  });

  it("gives every tier the whole pool: gaps, met and not-shown, so a trial never runs out of topics", () => {
    const trial = buildInterviewerContext(input([...MIXED, notShown], { maxDurationSeconds: 300 })).dynamicVariables;
    const full = buildInterviewerContext(input([...MIXED, notShown])).dynamicVariables;

    expect(trial.requirements_gaps.split("\n")).toHaveLength(2);
    expect(trial.requirements_met).toContain("React and TypeScript");
    expect(trial.requirements_not_evident).toContain("background check");
    expect({ ...trial, interview_minutes: "", opening_line: "" }).toEqual({ ...full, interview_minutes: "", opening_line: "" });
  });

  it("caps the pool at the context limit, gaps first, then met, then not-shown", () => {
    const many = Array.from({ length: 40 }, (_, i) => requirement({ requirement: `Skill ${i}`, status: i < 25 ? "missing" : "met" }));
    const { dynamicVariables } = buildInterviewerContext(input([...many, notShown]));
    expect(dynamicVariables.requirements_gaps.split("\n")).toHaveLength(25);
    expect(dynamicVariables.requirements_met.split("\n")).toHaveLength(MAX_CONTEXT_REQUIREMENTS - 25);
    expect(dynamicVariables.requirements_not_evident).toBe("(none)");
  });
});

describe("buildInterviewerContext: every placeholder has a value", () => {
  it("fills each placeholder the prompt and the first message reference, and nothing is empty", () => {
    const referenced = templatePlaceholders(`${INTERVIEWER_AGENT_PROMPT}\n${INTERVIEWER_FIRST_MESSAGE}`);
    expect(referenced.length).toBeGreaterThan(5);
    for (const name of referenced) {
      expect(INTERVIEWER_VARIABLE_NAMES, `placeholder {{${name}}}`).toContain(name);
    }

    const { dynamicVariables } = buildInterviewerContext(input(MIXED));

    expect(Object.keys(dynamicVariables).sort()).toEqual([...INTERVIEWER_VARIABLE_NAMES].sort());
    for (const [name, value] of Object.entries(dynamicVariables)) {
      expect(typeof value, name).toBe("string");
      expect(value.trim(), name).not.toBe("");
    }
    expect(dynamicVariables.interview_id).toBe("3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c");
    expect(dynamicVariables.interview_minutes).toBe("12");
  });

  it("tells a five-minute trial its length and never a question count", () => {
    const trial = buildInterviewerContext(input(MIXED, { maxDurationSeconds: 300 })).dynamicVariables;
    expect(trial.interview_minutes).toBe("5");
    expect(trial.opening_line).toContain("We have about 5 minutes.");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("The interview is about {{interview_minutes}} minutes long, and you fill all of it.");
    expect(INTERVIEWER_AGENT_PROMPT).not.toContain("gaps_to_cover");
  });

  it("ends the call only on the room's signal or the candidate's request, never because topics are covered", () => {
    expect(INTERVIEWER_AGENT_PROMPT).toContain("The call ends in only two ways, and you start neither on your own");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("In every other case you never close and never call end_call");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("Never say that you have covered everything");
    expect(INTERVIEWER_AGENT_PROMPT).not.toContain("hiring-side");
  });

  it("never ends over a pending question, never without a spoken goodbye, and confirms before ending on request", () => {
    // The mechanism, so no model attaches end_call to a turn that asks something.
    expect(INTERVIEWER_AGENT_PROMPT).toContain("it hangs up the moment the reply it is called with has been spoken");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("must never call end_call");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("Never end the call while a question of yours is unanswered");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("their silence is thinking time, not the end");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("a goodbye left only in the tool is never heard");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("Never close on the request alone");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("¿Quieres terminar la entrevista ahora?");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("it is never a yes by itself");
    // The half-time and two-minute lines must not be announced.
    expect(INTERVIEWER_AGENT_PROMPT).toContain("never call a question the last one");
  });

  it("speaks as one interviewer, with no organization behind the practice", () => {
    expect(INTERVIEWER_AGENT_PROMPT).toContain("Never use a \"we\" that stands for a company or a team");
    expect(INTERVIEWER_AGENT_PROMPT).toContain("con nosotros");
  });

  it("speaks English by default: opening line, language name", () => {
    const { language, dynamicVariables } = buildInterviewerContext(input(MIXED));

    expect(language).toBe("en");
    expect(dynamicVariables.language_name).toBe("English");
    expect(dynamicVariables.opening_line).toBe(
      "Hi Ana, thanks for joining. I'll be interviewing you for the Frontend Engineer role at Northwind. We have about 12 minutes. To start, tell me briefly about your background and what drew you to this role.",
    );
  });

  it("switches the opening line and language name to Spanish for a Spanish posting", () => {
    const { language, dynamicVariables } = buildInterviewerContext(
      input(MIXED, {
        jobDescription:
          "Buscamos un ingeniero frontend para el equipo de pagos. Requisitos: 3 años de experiencia con React y conocimientos de TypeScript.",
      }),
    );

    expect(language).toBe("es");
    expect(dynamicVariables.language_name).toBe("Spanish");
    expect(dynamicVariables.opening_line).toMatch(/^Hola Ana, gracias por conectarte\./);
    expect(dynamicVariables.opening_line).toContain("Frontend Engineer en Northwind");
  });

  it("addresses a candidate without a first name neutrally", () => {
    const { dynamicVariables } = buildInterviewerContext(input(MIXED, { candidateFirstName: null }));

    expect(dynamicVariables.candidate_name).toBe("there");
    expect(dynamicVariables.opening_line).toMatch(/^Hi there,/);
  });
});

describe("buildInterviewerContext: size", () => {
  // Every cap at its limit, in 3-byte characters: the posting at its schema
  // maximum, a runaway breakdown, and over-long quoted fields.
  const wide = (n: number) => "€".repeat(n);
  const largest = input(
    Array.from({ length: 120 }, (_, i) =>
      requirement({
        requirement: `${i} ${wide(1_000)}`,
        status: i % 3 === 0 ? "met" : i % 3 === 1 ? "partial" : "missing",
        evidence: wide(1_000),
        note: wide(1_000),
      }),
    ),
    { jobDescription: wide(MAX_JOB_DESCRIPTION_CHARS), analysisSummary: wide(5_000) },
  );

  it("stays under the budget for the largest possible input, keeping the description whole", () => {
    const { dynamicVariables } = buildInterviewerContext(largest);

    expect(interviewerContextBytes(dynamicVariables)).toBeLessThanOrEqual(INTERVIEWER_CONTEXT_BUDGET_BYTES);
    expect(dynamicVariables.job_description).toHaveLength(MAX_JOB_DESCRIPTION_CHARS);
  });

  it("drops met requirements before gaps when it has to trim", () => {
    const { dynamicVariables } = buildInterviewerContext(largest);
    const gapLines = dynamicVariables.requirements_gaps.split("\n");
    const metLines = dynamicVariables.requirements_met === "(none)" ? [] : dynamicVariables.requirements_met.split("\n");

    expect(gapLines.length).toBeGreaterThan(0);
    expect(gapLines.length + metLines.length).toBeLessThanOrEqual(MAX_CONTEXT_REQUIREMENTS);
    expect(gapLines.length).toBeGreaterThanOrEqual(metLines.length);
  });

  it("does not trim a realistic analysis at all", () => {
    const realistic = input(
      Array.from({ length: 12 }, (_, i) =>
        requirement({
          requirement: `Requirement ${i}: ${"familiarity with distributed systems and public clouds ".repeat(3)}`,
          status: i % 2 ? "met" : "missing",
          evidence: i % 2 ? "Designed and operated services on AWS with CloudWatch telemetry".repeat(2) : "",
          note: "One sentence on why that status, naming the alternative the candidate has.".repeat(2),
        }),
      ),
      { jobDescription: "Senior engineer. ".repeat(470).slice(0, MAX_JOB_DESCRIPTION_CHARS) },
    );

    const { dynamicVariables } = buildInterviewerContext(realistic);

    expect(dynamicVariables.requirements_gaps.split("\n")).toHaveLength(6);
    expect(dynamicVariables.requirements_met.split("\n")).toHaveLength(6);
    expect(interviewerContextBytes(dynamicVariables)).toBeLessThan(INTERVIEWER_CONTEXT_BUDGET_BYTES / 2);
  });
});
