import { describe, expect, it } from "vitest";
import { buildGold, locate, normalize, score, sumMetrics, type GoldFile } from "./gold";

const POSTING = `Backend Developer

What you will do
- Run our Kubernetes clusters day to day.

Required qualifications
- 3+ years of professional backend development experience.
- Experience writing production code in C, C++, Java, JavaScript or Python.
- Experience with containers and CI/CD pipelines.

Preferred qualifications
- Experience running Kubernetes in production.

We offer a yearly learning budget and flexible hours.`;

const FILE: GoldFile = {
  fixture: "unit",
  status: "final",
  requirements: [
    { id: "r1", kind: "required", name: "3+ years of professional backend development", spans: ["3+ years of professional backend development experience."], status: "met" },
    { id: "r2", kind: "required", name: "Production code in C, C++, Java, JavaScript or Python", spans: ["Experience writing production code in C, C++, Java, JavaScript or Python."], status: "met" },
    {
      id: "r3",
      kind: "required",
      name: "Containers and CI/CD pipelines",
      spans: ["Experience with containers and CI/CD pipelines."],
      splitAllowed: true,
      alsoAcceptedAs: ["containers", "CI/CD pipelines"],
      status: "missing",
    },
    { id: "p1", kind: "preferred", name: "Running Kubernetes in production", spans: ["Experience running Kubernetes in production."], aliases: ["Kubernetes"], status: "missing", contested: true },
  ],
  notRequirements: [
    { span: "We offer a yearly learning budget and flexible hours.", reason: "benefit" },
    { span: "Run our Kubernetes clusters day to day.", reason: "responsibility" },
  ],
};

const gold = buildGold(FILE, POSTING);

describe("normalize and locate", () => {
  it("keeps C, C++ and C# apart and ignores case and punctuation", () => {
    expect(normalize("C, C++, C#!")).toBe("c c++ c#");
    expect(normalize("Hands-on  Experience")).toBe("hands on experience");
  });

  it("finds an exact span, a paraphrase by its n-grams, and nothing for text from elsewhere", () => {
    expect(locate(gold.normalized, "containers and CI/CD pipelines")?.exact).toBe(true);
    const paraphrase = locate(gold.normalized, "Professional backend development experience of 3+ years");
    expect(paraphrase).not.toBeNull();
    expect(paraphrase?.exact).toBe(false);
    expect(locate(gold.normalized, "A degree in Computer Science from a top university")).toBeNull();
  });

  it("refuses a gold span that is not in the posting", () => {
    expect(() => buildGold({ ...FILE, requirements: [{ id: "x", kind: "required", name: "x", spans: ["Fluent English"] }] }, POSTING)).toThrow(/not in job.txt/);
  });
});

describe("score", () => {
  it("matches by span, falls back to the name, and classifies the rest", () => {
    const { metrics, items, gold: verdicts } = score(gold, [
      { requirement: "3+ years of professional backend development experience", kind: "required", status: "met" },
      { requirement: "Production Kubernetes operation", kind: "preferred", status: "missing" },
      { requirement: "A yearly learning budget", kind: "preferred", status: "missing" },
      { requirement: "A degree in Computer Science", kind: "required", status: "missing" },
    ]);
    expect(items[0]).toMatchObject({ outcome: "match", matcher: "span", goldIds: ["r1"] });
    expect(items[1]).toMatchObject({ outcome: "match", matcher: "name", goldIds: ["p1"] });
    expect(items[2]).toMatchObject({ outcome: "over-extraction", reason: "benefit" });
    expect(items[3]).toMatchObject({ outcome: "invention" });
    // Posting text outside every gold span is over-extraction even when it is named like a gold item.
    expect(score(gold, [{ requirement: "Run our Kubernetes clusters day to day", kind: "required" }]).items[0]).toMatchObject({ outcome: "over-extraction", reason: "responsibility" });
    expect(metrics).toMatchObject({ goldTotal: 4, goldFound: 2, extracted: 4, correct: 2, inventions: 1, overExtractions: 1, splits: 0, merges: 0, bySpan: 1, byName: 1 });
    expect(metrics.recallUncontested).toBeCloseTo(1 / 3);
    expect(verdicts.find((one) => one.id === "r1")).toMatchObject({ statusCorrect: true, kindCorrect: true });
  });

  it("accepts a split the gold allows, counts one it does not, and counts a merge", () => {
    const { metrics, items } = score(gold, [
      { requirement: "containers", kind: "required" },
      { requirement: "CI/CD pipelines", kind: "required" },
      { requirement: "3+ years of professional backend development", kind: "required" },
      { requirement: "3+ years backend development experience", kind: "required" },
      { requirement: "3+ years of professional backend development experience. Experience writing production code in C, C++, Java, JavaScript or Python.", kind: "required" },
    ]);
    expect(items[0]).toMatchObject({ outcome: "match", goldIds: ["r3"], part: "containers", split: false });
    expect(items[1]).toMatchObject({ outcome: "match", goldIds: ["r3"], part: "CI/CD pipelines", split: false });
    expect(items[3]).toMatchObject({ outcome: "match", goldIds: ["r1"], split: true });
    expect(items[4]).toMatchObject({ outcome: "match", merge: true });
    expect((items[4] as { goldIds: string[] }).goldIds).toEqual(["r1", "r2"]);
    expect(metrics.splits).toBe(1);
    expect(metrics.merges).toBe(1);
    expect(metrics.goldFound).toBe(3);
  });

  it("uses the source quote to locate an item when the arm supplies one", () => {
    const { items } = score(gold, [
      { requirement: "Mastery of one of the listed programming languages", kind: "required", source: "Experience writing production code in C, C++, Java, JavaScript or Python." },
    ]);
    expect(items[0]).toMatchObject({ outcome: "match", matcher: "span", goldIds: ["r2"] });
  });

  it("scores kind and status, flags a met/missing swap as severe, and sums metrics", () => {
    const one = score(gold, [
      { requirement: "3+ years of professional backend development experience", kind: "preferred", status: "missing" },
      { requirement: "Experience with containers and CI/CD pipelines", kind: "required", status: "partial" },
    ]);
    expect(one.metrics).toMatchObject({ kindTotal: 2, kindCorrect: 1, statusTotal: 2, statusCorrect: 0, statusSevere: 1 });
    const total = sumMetrics([one.metrics, one.metrics]);
    expect(total.goldTotal).toBe(8);
    expect(total.recall).toBeCloseTo(0.5);
    expect(total.statusSevere).toBe(2);
  });
});
