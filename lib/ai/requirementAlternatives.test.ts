import { describe, expect, it } from "vitest";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import { quoteAlternatives, relatedFieldIn, withQuoteAlternatives, withRelatedField } from "./requirementAlternatives";
import { enforceRequirementStatuses } from "./requirementGuardrails";

const texts = (quote: string) => quoteAlternatives(quote).map((set) => set.map((item) => item.text));

describe("quoteAlternatives", () => {
  it("reads items joined by or, with the comma-listed items before them", () => {
    expect(texts("Experience with Spark, Flink or Beam for large-scale processing.")).toEqual([["Spark", "Flink", "Beam"]]);
    expect(texts("Kafka or Kinesis in production.")).toEqual([["Kafka", "Kinesis"]]);
    expect(texts("Dashboards in Tableau o Metabase.")).toEqual([["Tableau", "Metabase"]]);
  });

  it("marks the item that borrows its noun from the next one", () => {
    expect(quoteAlternatives("4+ years as a product or project manager.")).toEqual([
      [
        { text: "product", elliptical: true },
        { text: "project manager", elliptical: false },
      ],
    ]);
    expect(quoteAlternatives("Rust or Go.")[0][0].elliptical).toBe(false);
  });

  it("reads a parenthesised list and an examples list", () => {
    expect(texts("A columnar store (ClickHouse, Druid or Pinot).")).toEqual([["ClickHouse", "Druid", "Pinot"]]);
    expect(texts("A queue such as RabbitMQ, NATS and SQS.")).toEqual([["RabbitMQ", "NATS", "SQS"]]);
    expect(texts("Un orquestador, por ejemplo Prefect o Luigi.")).toEqual([["Prefect", "Luigi"]]);
    expect(texts("Experiencia como analista de datos o de negocio.").flat()).not.toContain("de negocio");
  });

  it("finds no alternatives in a list joined by and, a slash or and/or", () => {
    expect(texts("CI/CD pipelines and Terraform.")).toEqual([]);
    expect(texts("Customer and/or partner audits.")).toEqual([]);
  });
});

describe("withQuoteAlternatives", () => {
  const quote = "4+ years as a product or project manager.";
  const terms = { mode: "any" as const, terms: [{ term: "project manager", cvMatch: "" }] };

  it("leaves an elided item unexamined: the code cannot look for it", () => {
    const out = withQuoteAlternatives(terms, quote, "Product owner at a logistics start-up.", false, "p");
    expect(out.unexamined).toEqual(["product"]);
    expect(out.keyTerms.terms).toHaveLength(1);
  });

  it("adds an item the CV states verbatim as shown, and one it lacks as absent", () => {
    const listed = { mode: "any" as const, terms: [{ term: "Kafka", cvMatch: "" }] };
    expect(withQuoteAlternatives(listed, "Kafka or Kinesis in production.", "Streams on Kinesis.", false, "p").keyTerms.terms).toEqual([
      { term: "Kafka", cvMatch: "" },
      { term: "Kinesis", cvMatch: "Kinesis" },
    ]);
    const absent = withQuoteAlternatives(listed, "Kafka or Kinesis in production.", "Batch jobs only.", false, "p");
    expect(absent.keyTerms.terms[1]).toEqual({ term: "Kinesis", cvMatch: "" });
    expect(absent.unexamined).toEqual([]);
  });

  it("counts every miss as unexamined when the CV is in another language", () => {
    const listed = { mode: "any" as const, terms: [{ term: "Kafka", cvMatch: "" }] };
    expect(withQuoteAlternatives(listed, "Kafka or Kinesis in production.", "Colas de mensajes.", true, "p").unexamined).toEqual(["Kinesis"]);
  });

  it("never reads a list the model's terms are not in, nor an unshowable alternative", () => {
    const listed = { mode: "all" as const, terms: [{ term: "SQL", cvMatch: "SQL" }] };
    expect(withQuoteAlternatives(listed, "Strong SQL; a warehouse such as Redshift or Synapse.", "SQL", false, "p").keyTerms.terms).toHaveLength(1);
    const elixir = { mode: "any" as const, terms: [{ term: "Elixir", cvMatch: "" }] };
    expect(withQuoteAlternatives(elixir, "Elixir or willingness to learn it.", "", false, "p").keyTerms.terms).toHaveLength(1);
  });
});

describe("withRelatedField", () => {
  const quote = "Bachelor's degree in Physics, Mathematics, or a related field.";

  it("moves a match naming another discipline onto the posting's related field", () => {
    const out = withRelatedField({ mode: "any", terms: [{ term: "Physics", cvMatch: "Applied Optics" }] }, quote, "p");
    expect(out.keyTerms.terms).toEqual([
      { term: "Physics", cvMatch: "" },
      { term: "related field", cvMatch: "Applied Optics" },
    ]);
  });

  it("keeps a match that names the discipline, and a degree without a related field", () => {
    const named = { mode: "any" as const, terms: [{ term: "Physics", cvMatch: "BSc Physics" }] };
    expect(withRelatedField(named, quote, "p").keyTerms).toBe(named);
    const strict = { mode: "any" as const, terms: [{ term: "Physics", cvMatch: "Applied Optics" }] };
    expect(withRelatedField(strict, "Bachelor's degree in Physics.", "p").keyTerms).toBe(strict);
    expect(relatedFieldIn("Experience in a related field.")).toBeNull();
    expect(relatedFieldIn("Título en Química o carreras afines.")).toBe("carreras afines");
  });
});

describe("enforceRequirementStatuses with alternatives", () => {
  const requirement = (over: Partial<Requirement>): Requirement => ({
    requirement: "4+ years as a product or project manager",
    sourceQuote: "4+ years as a product or project manager.",
    kind: "required",
    status: "met",
    evidence: "Responsable de producto | Tiendas Norte | 2019 - 2024",
    note: "",
    assessable: true,
    keyTerms: { mode: "any", terms: [{ term: "project manager", cvMatch: "" }] },
    ...over,
  });
  const cv = "Responsable de producto | Tiendas Norte | 2019 - 2024\nLideré el catálogo y el equipo de compras.";

  it("never caps to missing while an alternative of the quote is unexamined", () => {
    const { requirements, interventions } = enforceRequirementStatuses([requirement({})], {
      pending: [{ yearsEvidence: ["2019 - 2024"] }],
      cvText: cv,
      now: new Date("2026-11-10T00:00:00Z"),
      crossLanguage: true,
    });
    expect(requirements[0].status).toBe("met");
    expect(interventions).toContainEqual(expect.objectContaining({ action: "cap-skipped", replacement: "product" }));
    expect(interventions.some((one) => one.action === "status-capped")).toBe(false);
  });

  it("still caps when every alternative was examined", () => {
    const { requirements } = enforceRequirementStatuses(
      [requirement({ sourceQuote: "Kafka or Kinesis in production.", requirement: "Kafka or Kinesis in production", keyTerms: { mode: "any", terms: [{ term: "Kafka", cvMatch: "" }] } })],
      { pending: [{ yearsEvidence: [] }], cvText: "Batch jobs in Airflow.", now: new Date("2026-11-10T00:00:00Z") },
    );
    expect(requirements[0].status).toBe("missing");
    expect(requirements[0].note).toBe("Your CV doesn't show any of Kafka or Kinesis.");
  });
});

describe("open alternatives", () => {
  it("never adds an alternative no CV word can show: equivalent experience, a related or similar field", () => {
    const listed = { mode: "any" as const, terms: [{ term: "Physics", cvMatch: "" }] };
    const out = withQuoteAlternatives(listed, "A degree in Physics or equivalent experience.", "Lab technician.", false, "p");
    expect(out.keyTerms.terms).toHaveLength(1);
    expect(out.unexamined).toEqual([]);
  });
});

describe("a related field in an 'all' list", () => {
  it("is one group with the disciplines it stands for, so it satisfies the degree", () => {
    const quote = "Master's degree in Chemistry, Biology, or a related field.";
    const moved = withRelatedField({ mode: "all", terms: [{ term: "Chemistry", cvMatch: "Biochemical Engineering" }] }, quote, "p");
    const { requirements } = enforceRequirementStatuses(
      [{ requirement: quote, sourceQuote: quote, kind: "required", status: "met", evidence: "MSc Biochemical Engineering", note: "", assessable: true, keyTerms: moved.keyTerms }],
      { pending: [{ yearsEvidence: [] }], cvText: "MSc Biochemical Engineering, 2020.", now: new Date("2026-11-10T00:00:00Z") },
    );
    expect(requirements[0].status).toBe("met");
    expect(requirements[0].keyTerms?.terms).toEqual([{ term: "related field", cvMatch: "Biochemical Engineering" }]);
  });
});
