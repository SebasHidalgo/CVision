import { describe, expect, it } from "vitest";
import type { ModelRequirement } from "@/lib/schemas/resumeSchema";
import { headingOf, introducesQualifications, mergeRepair, postingBullets, uncoveredBullets } from "./requirementCoverage";

const POSTING = `Platform Engineer
Lumen Rail · Remote

About us
We run the ticketing platform for twelve regional railways.

What you will do
- Operate our Kubernetes clusters.
- Write runbooks for the on-call rotation.

Requirements
- 4+ years in platform or infrastructure roles.
- A degree in Computer Science or equivalent experience.
- Terraform, or another infrastructure-as-code tool,
  used in production.

Nice to have
- Experience in transport or logistics.

What we offer
- Twenty-eight days of leave.`;

const entry = (sourceQuote: string, over: Partial<ModelRequirement> = {}): ModelRequirement => ({
  sourceQuote,
  heading: "",
  section: "requirements",
  demandsCapability: true,
  requirement: sourceQuote,
  softenedClause: { quote: "", status: "missing", evidence: "", note: "" },
  keyTerms: { mode: "all", terms: [] },
  kind: "required",
  assessable: true,
  yearsEvidence: [],
  evidence: "",
  status: "missing",
  note: "",
  ...over,
});

describe("headings", () => {
  it("reads short unpunctuated lines, markdown and colons as headings", () => {
    expect(headingOf("Requirements")).toBe("Requirements");
    expect(headingOf("## What you bring:")).toBe("What you bring");
    expect(headingOf("**Requisitos:**")).toBe("Requisitos");
    expect(headingOf("- Strong SQL")).toBeNull();
    expect(headingOf("  C++, C#, Java")).toBeNull();
    expect(headingOf("We run the ticketing platform for twelve regional railways.")).toBeNull();
  });

  it("knows which headings introduce qualifications", () => {
    for (const heading of ["Requirements", "Nice to have", "What we are looking for", "Job Requirements: Other & Additional", "Valoramos", "Perfil", "Bonus points"]) {
      expect(introducesQualifications(heading), heading).toBe(true);
    }
    for (const heading of ["What you will do", "About us", "What we offer", "Additional information", "Perks & benefits", "How we hire"]) {
      expect(introducesQualifications(heading), heading).toBe(false);
    }
  });
});

describe("postingBullets", () => {
  it("lists the bullets under qualification headings only, wrapped lines joined", () => {
    expect(postingBullets(POSTING).map((bullet) => [bullet.heading, bullet.text])).toEqual([
      ["Requirements", "4+ years in platform or infrastructure roles."],
      ["Requirements", "A degree in Computer Science or equivalent experience."],
      ["Requirements", "Terraform, or another infrastructure-as-code tool, used in production."],
      ["Nice to have", "Experience in transport or logistics."],
    ]);
  });

  it("reads a list without markers line by line, up to the next heading", () => {
    const posting = "Analyst\n\nQualifications\n\nStrong SQL and dashboards.\n\nFluent English.\nAbout the team\nWe are five.";
    expect(postingBullets(posting).map((bullet) => bullet.text)).toEqual(["Strong SQL and dashboards.", "Fluent English."]);
  });

  it("closes a marked list at the prose after it", () => {
    const posting = "Analyst\n\nYou have\n- Strong SQL.\n\nIt helps if you have run experiments before, but we will teach you.";
    expect(postingBullets(posting).map((bullet) => bullet.text)).toEqual(["Strong SQL."]);
  });

  it("finds nothing in a posting without qualification headings", () => {
    expect(postingBullets("Junior QA\n\nYou should have 1+ years testing web apps.")).toEqual([]);
  });
});

describe("uncoveredBullets", () => {
  it("is empty when every bullet is overlapped by a quote, a softened clause or a dropped description entry", () => {
    const entries = [
      entry("4+ years in platform or infrastructure roles."),
      entry("A degree in Computer Science", { softenedClause: { quote: "", status: "missing", evidence: "", note: "" } }),
      entry("Terraform, or another infrastructure-as-code tool"),
      entry("Experience in transport or logistics.", { section: "description" }),
    ];
    expect(uncoveredBullets(POSTING, entries)).toEqual([]);
  });

  it("returns the bullet no entry quotes, and one whose quote is not in the posting", () => {
    const entries = [
      entry("4+ years in platform or infrastructure roles."),
      entry("A degree in computing or similar"),
      entry("Experience in transport or logistics."),
    ];
    expect(uncoveredBullets(POSTING, entries).map((bullet) => bullet.text)).toEqual([
      "A degree in Computer Science or equivalent experience.",
      "Terraform, or another infrastructure-as-code tool, used in production.",
    ]);
  });
});

describe("mergeRepair", () => {
  const first = [entry("4+ years in platform or infrastructure roles."), entry("Experience in transport or logistics.", { kind: "preferred" })];

  it("records each uncovered line and changes nothing without a repair", () => {
    const merged = mergeRepair(POSTING, first, undefined);
    expect(merged.requirements).toBe(first);
    expect(merged.interventions.map((one) => [one.action, one.value])).toEqual([
      ["requirement-uncovered", "A degree in Computer Science or equivalent experience."],
      ["requirement-uncovered", "Terraform, or another infrastructure-as-code tool, used in production."],
    ]);
  });

  it("adds repair entries in posting order and counts the lines they cover", () => {
    const merged = mergeRepair(POSTING, first, {
      requirements: [
        entry("Terraform, or another infrastructure-as-code tool,"),
        entry("A degree in Computer Science or equivalent experience."),
        entry("Operate our Kubernetes clusters."),
      ],
    });
    expect(merged.requirements.map((one) => one.sourceQuote)).toEqual([
      "4+ years in platform or infrastructure roles.",
      "A degree in Computer Science or equivalent experience.",
      "Terraform, or another infrastructure-as-code tool,",
      "Experience in transport or logistics.",
    ]);
    expect(merged.interventions.filter((one) => one.action === "requirement-recovered").map((one) => one.replacement)).toEqual(["requirement added", "requirement added"]);
    // An entry for a line that was already covered is not added twice.
    expect(merged.interventions).toContainEqual(expect.objectContaining({ action: "recorded", replacement: "repair entry outside the skipped lines" }));
  });

  it("counts a restatement of a listed requirement as covered without adding it", () => {
    const merged = mergeRepair(POSTING, first, {
      requirements: [
        entry("A degree in Computer Science or equivalent experience.", { requirement: "4+ years in platform or infrastructure roles." }),
        entry("Terraform, or another infrastructure-as-code tool,", { section: "description" }),
      ],
    });
    expect(merged.requirements.map((one) => one.sourceQuote)).toEqual([
      "4+ years in platform or infrastructure roles.",
      "Terraform, or another infrastructure-as-code tool,",
      "Experience in transport or logistics.",
    ]);
    expect(merged.interventions.filter((one) => one.action === "requirement-recovered").map((one) => one.replacement)).toEqual([
      "restates a listed requirement",
      "not a requirement",
    ]);
  });

  it("records a failed repair and keeps the first list", () => {
    const merged = mergeRepair(POSTING, first, { requirements: null, error: "AI_UNAVAILABLE" });
    expect(merged.requirements).toBe(first);
    expect(merged.interventions).toContainEqual(expect.objectContaining({ action: "recorded", replacement: "repair failed: AI_UNAVAILABLE" }));
  });
});
