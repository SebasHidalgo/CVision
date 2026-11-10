import { describe, expect, it } from "vitest";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import { guardRecommendations, outcomeSentences, withOutcomeProse } from "./requirementProse";

const item = (over: Partial<Requirement>): Requirement => ({
  requirement: "x",
  sourceQuote: "x",
  kind: "required",
  status: "met",
  evidence: "",
  note: "",
  assessable: true,
  ...over,
});

const REQUIREMENTS: Requirement[] = [
  item({ requirement: "Docker in production", sourceQuote: "Docker in production.", keyTerms: { mode: "all", terms: [{ term: "Docker", cvMatch: "Docker" }] } }),
  item({
    requirement: "Phoenix and Ecto",
    sourceQuote: "Phoenix and Ecto.",
    status: "partial",
    keyTerms: { mode: "all", terms: [{ term: "Phoenix", cvMatch: "Phoenix" }, { term: "Ecto", cvMatch: "" }] },
  }),
  item({ requirement: "6+ years building web services", sourceQuote: "6+ years building web services.", status: "missing", years: { min: 6, candidate: 3, source: "statement" } }),
  item({
    requirement: "Elixir or willingness to learn it",
    sourceQuote: "Elixir or willingness to learn it.",
    status: "not_evident",
    keyTerms: { mode: "any", terms: [{ term: "Elixir", cvMatch: "" }] },
  }),
  item({ requirement: "Fluent German", sourceQuote: "Fluent German.", status: "not_evident" }),
  item({ requirement: "Calm under pressure", sourceQuote: "Calm under pressure.", status: "not_evident", assessable: false }),
  item({ requirement: "Experience in agriculture would help but is not essential", sourceQuote: "Experience in agriculture would help but is not essential.", kind: "preferred", status: "missing" }),
];

describe("outcomeSentences", () => {
  it("writes the count, each gap, the posting's alternative, the language advice and what no CV can show", () => {
    expect(outcomeSentences(REQUIREMENTS)).toEqual([
      "Your CV fully shows 1 of the 3 required qualifications a CV can show.",
      "Your CV shows Phoenix but not Ecto.",
      "The posting asks for 6+ years; your CV shows about 3.",
      "Elixir isn't in your CV; the posting accepts willingness to learn it — say so in your cover letter.",
      "Your CV doesn't state your German level. Add a Languages line, e.g. 'Spanish (native), English (C1)'.",
      'One required item no CV can show is under "Not shown in your CV"; expect it in the interview or the hiring process.',
      "Preferred and not shown: Experience in agriculture.",
    ]);
  });

  it("writes nothing for a posting without required items", () => {
    expect(outcomeSentences([item({ kind: "preferred" })])).toEqual([]);
  });
});

describe("withOutcomeProse", () => {
  it("drops the model's outcome sentences and keeps its comments on the document", () => {
    const { description, interventions } = withOutcomeProse(
      "Your profile has major gaps in Elixir and Ecto. Additionally, your bullets read clearly and lead with results. Your experience aligns well with the role.",
      REQUIREMENTS,
    );
    expect(description.endsWith("Preferred and not shown: Experience in agriculture. Your bullets read clearly and lead with results.")).toBe(true);
    expect(interventions.map((one) => one.value)).toEqual(["Your profile has major gaps in Elixir and Ecto.", "Your experience aligns well with the role."]);
  });
});

describe("guardRecommendations", () => {
  it("drops willingness offered for a requirement whose posting accepts none, and a met item treated as a gap", () => {
    const { recommendations, interventions } = guardRecommendations(
      [
        "Mention your willingness to learn Ecto in your summary.",
        "Say in your cover letter that you are willing to learn Elixir.",
        "Gain experience with Docker through a side project.",
        "Move the Docker bullet above the older roles to complement your certification.",
      ],
      REQUIREMENTS,
    );
    expect(recommendations).toEqual(["Say in your cover letter that you are willing to learn Elixir.", "Move the Docker bullet above the older roles to complement your certification."]);
    expect(interventions.map((one) => one.replacement)).toEqual(["willingness the posting does not accept", "a met requirement as a gap"]);
  });
});
