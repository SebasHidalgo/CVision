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

describe("withOutcomeProse: advice (M8-H)", () => {
  const dropped = (description: string) => withOutcomeProse(description, REQUIREMENTS).interventions.map((one) => [one.value, one.replacement]);

  it("keeps advice, even when it says 'align' and 'this role'", () => {
    expect(dropped("To better align with this role, emphasize your Docker work near the top of your experience.")).toEqual([]);
    expect(dropped("Bringing your release metrics forward would further maximize your alignment.")).toEqual([]);
    expect(dropped("To strengthen your application, address the lack of Elixir experience in your cover letter.")).toEqual([]);
    expect(dropped("You can further improve your alignment by detailing how you use Docker day to day.")).toEqual([]);
  });

  it("drops advice that contradicts the statuses", () => {
    const absent = "To better align, add side projects, since Phoenix is absent from your CV.";
    const gap = "To close the gaps, emphasize Docker more prominently.";
    const fit = "Moving your Docker bullet up would showcase your strong fit.";
    const willing = "To close the gap, mention your willingness to learn Ecto.";
    expect(dropped([absent, gap, fit, willing].join(" "))).toEqual([
      [absent, "calls a shown requirement absent"],
      [gap, "a met requirement as a gap"],
      [fit, "a strong fit the required items do not show"],
      [willing, "willingness the posting does not accept"],
    ]);
  });

  it("still drops an outcome sentence that is not advice", () => {
    expect(dropped("Your experience aligns exceptionally well with this role.")).toEqual([["Your experience aligns exceptionally well with this role.", undefined]]);
  });
});

describe("M8-H: a requirement under 'Not shown in your CV' is not a gap", () => {
  it("drops advice and recommendations that call one a gap", () => {
    const advice = "To close the gaps, mention any Elixir side projects.";
    expect(withOutcomeProse(advice, REQUIREMENTS).interventions.map((one) => one.replacement)).toEqual(["a requirement no CV can show as a gap"]);
    const { recommendations, interventions } = guardRecommendations(["Highlight any Elixir or Ecto projects to address these gaps.", "Say in your cover letter that you are willing to learn Elixir."], REQUIREMENTS);
    expect(recommendations).toEqual(["Say in your cover letter that you are willing to learn Elixir."]);
    expect(interventions.map((one) => one.replacement)).toEqual(["a requirement no CV can show as a gap"]);
  });

  it("names the examples a requirement made only of examples lacks, and never ends a cut label with '….'", () => {
    const tools = item({
      requirement: "Hands-on time with brokers such as NATS, RabbitMQ and SQS across several services",
      sourceQuote: "Hands-on time with brokers such as NATS, RabbitMQ and SQS.",
      status: "missing",
      keyTerms: { mode: "any", terms: [{ term: "NATS", cvMatch: "" }, { term: "SQS", cvMatch: "" }] },
    });
    expect(outcomeSentences([tools])).toContain("Not shown as asked: NATS or SQS.");
    const long = item({ requirement: "Experience working with tools of every kind, across teams, offices, and many time zones", sourceQuote: "x", status: "missing" });
    expect(outcomeSentences([long])).toContain("Not shown as asked: Experience working with tools of every kind, across teams…");
  });
});

describe("guardRecommendations: a requirement is named by a full term", () => {
  it("does not read 'Ruby' as 'Ruby on Rails'", () => {
    const rails = item({ requirement: "Ruby on Rails", sourceQuote: "Ruby on Rails.", keyTerms: { mode: "all", terms: [{ term: "Ruby on Rails", cvMatch: "Rails" }] } });
    expect(guardRecommendations(["Gain experience with Ruby scripting for build tooling."], [rails]).recommendations).toHaveLength(1);
    expect(guardRecommendations(["Gain experience with Ruby on Rails through a side project."], [rails]).recommendations).toHaveLength(0);
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

describe("guardRecommendations: other willingness", () => {
  it("keeps willingness to relocate: only willingness to learn is an alternative", () => {
    const relocation = item({ requirement: "Relocation to Lyon", sourceQuote: "Relocation to Lyon.", status: "not_evident", assessable: false, keyTerms: { mode: "all", terms: [{ term: "Lyon", cvMatch: "" }] } });
    expect(guardRecommendations(["State your willingness to relocate to Lyon in the summary."], [relocation]).recommendations).toHaveLength(1);
  });
});
