import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import { NOT_SHOWN_ADVICE, Requirements, SKILLS_ONLY_ADVICE, SUMMARY_ONLY_ADVICE } from "./SectionParts";

const row = (requirement: string, kind: Requirement["kind"], status: Requirement["status"]): Requirement => ({
  requirement,
  kind,
  status,
  evidence: "",
  note: "",
});

describe("Requirements", () => {
  it("shows what a CV cannot show in its own group, with the advice, and keeps it out of the counts", () => {
    const requirements = [
      row("SQL", "required", "met"),
      row("Pass a background check", "required", "not_evident"),
      row("Power BI", "preferred", "missing"),
    ];
    const tally = {
      required: { total: 1, met: 1, partial: 0, notShown: 1 },
      preferred: { total: 1, met: 0, partial: 0, notShown: 0 },
    };

    const html = renderToStaticMarkup(<Requirements requirements={requirements} tally={tally} />);

    expect(html).toContain("Not shown in your CV");
    expect(html).toContain(NOT_SHOWN_ADVICE.replace("'", "&#x27;"));
    expect(html.indexOf("Pass a background check")).toBeGreaterThan(html.indexOf("Not shown in your CV"));
    expect(html).toContain("1 of 1 met");
  });

  it("renders a stored analysis with none of them exactly as before: no extra group", () => {
    const html = renderToStaticMarkup(
      <Requirements
        requirements={[row("SQL", "required", "met")]}
        tally={{ required: { total: 1, met: 1, partial: 0, notShown: 0 }, preferred: { total: 0, met: 0, partial: 0, notShown: 0 } }}
      />,
    );

    expect(html).not.toContain("Not shown in your CV");
    expect(html).not.toContain("Terms the posting names");
  });

  it("shows each term with what the CV has, the skills-only advice, and the quote without its bullet", () => {
    const requirement: Requirement = {
      ...row("Deep knowledge of Ruby on Rails and MySQL", "required", "partial"),
      evidence: "• Databases: MongoDB, Postgres, MySQL",
      evidenceSource: "skills",
      skillsOnly: true,
      keyTerms: { mode: "all", terms: [{ term: "Ruby on Rails", cvMatch: "" }, { term: "MySQL", cvMatch: "MySQL" }, { term: "PostgreSQL", cvMatch: "Postgres" }] },
    };
    const tally = { required: { total: 1, met: 0, partial: 1, notShown: 0 }, preferred: { total: 0, met: 0, partial: 0, notShown: 0 } };

    const html = renderToStaticMarkup(<Requirements requirements={[requirement]} tally={tally} />);
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("Ruby on Railsnot in your CV");
    expect(text).toContain("MySQLshown in your CV");
    expect(text).toContain("PostgreSQLshown in your CV(Postgres)");
    expect(text).not.toContain("MySQLshown in your CV(MySQL)");
    expect(text).toContain(SKILLS_ONLY_ADVICE);
    expect(text).toContain("Databases: MongoDB, Postgres, MySQL");
    expect(text).not.toContain("• Databases");
  });

  it("lists every alternative of an 'any' requirement joined by 'or', and the advice only when flagged", () => {
    const requirement: Requirement = {
      ...row("Coding in C, C++ or Python", "required", "met"),
      sourceQuote: "Coding in C, C++ or Python.",
      evidence: "Languages: C++",
      evidenceSource: "skills",
      skillsOnly: false,
      keyTerms: { mode: "any", terms: [{ term: "C", cvMatch: "" }, { term: "C++", cvMatch: "C++" }, { term: "Python", cvMatch: "" }] },
    };
    const tally = { required: { total: 1, met: 1, partial: 0, notShown: 0 }, preferred: { total: 0, met: 0, partial: 0, notShown: 0 } };

    const text = renderToStaticMarkup(<Requirements requirements={[requirement]} tally={tally} />).replace(/<[^>]+>/g, "");

    expect(text).toContain("Cnot in your CVorC++shown in your CVorPythonnot in your CV");
    expect(text).not.toContain(SKILLS_ONLY_ADVICE);
  });

  it("shows the posting's examples on their own line, after 'e.g.' (M8-H)", () => {
    const quote = "Familiarity with message queues (e.g., Kafka, RabbitMQ, SQS), including alerting.";
    const requirement: Requirement = {
      ...row(quote, "preferred", "partial"),
      sourceQuote: quote,
      keyTerms: {
        mode: "all",
        terms: [
          { term: "message queues", cvMatch: "NATS" },
          { term: "alerting", cvMatch: "" },
          { term: "Kafka", cvMatch: "" },
          { term: "SQS", cvMatch: "" },
        ],
      },
    };
    const tally = { required: { total: 0, met: 0, partial: 0, notShown: 0 }, preferred: { total: 1, met: 0, partial: 1, notShown: 0 } };

    const html = renderToStaticMarkup(<Requirements requirements={[requirement]} tally={tally} />);
    const text = html.replace(/<[^>]+>/g, "");

    expect(html).toContain('aria-label="Examples the posting gives"');
    expect(text).toContain("message queuesshown in your CV(NATS)·alertingnot in your CV");
    expect(text).toContain("e.g.Kafkanot in your CV·SQSnot in your CV");
  });

  it("shows no ✓ or ✗ under 'Not shown in your CV', and keeps its note", () => {
    const requirement: Requirement = {
      ...row("Fluency in English", "required", "not_evident"),
      note: "Your CV doesn't state your English level.",
      keyTerms: { mode: "any", terms: [{ term: "English", cvMatch: "English" }] },
    };
    const tally = { required: { total: 0, met: 0, partial: 0, notShown: 1 }, preferred: { total: 0, met: 0, partial: 0, notShown: 0 } };

    const html = renderToStaticMarkup(<Requirements requirements={[requirement]} tally={tally} />);

    expect(html).not.toContain("Terms the posting names");
    expect(html).not.toContain('class="sr-only">shown in your CV');
    expect(html).toContain("Your CV doesn&#x27;t state your English level.");
  });

  it("shows the summary-only advice on a claim the summary alone makes", () => {
    const requirement: Requirement = {
      ...row("Strong understanding of software architecture", "required", "met"),
      evidence: "Engineer focused on clean architecture and scalable systems.",
      evidenceSource: "summary",
      summaryOnly: true,
    };
    const tally = { required: { total: 1, met: 1, partial: 0, notShown: 0 }, preferred: { total: 0, met: 0, partial: 0, notShown: 0 } };

    const text = renderToStaticMarkup(<Requirements requirements={[requirement]} tally={tally} />).replace(/<[^>]+>/g, "");

    expect(text).toContain(SUMMARY_ONLY_ADVICE);
    expect(text).not.toContain(SKILLS_ONLY_ADVICE);
  });

  it("never quotes the CV under a stored 'Not shown in your CV' row", () => {
    const requirement: Requirement = { ...row("Comfortable saying no to senior stakeholders", "required", "not_evident"), evidence: "Pushed back on a launch date", assessable: false };
    const tally = { required: { total: 0, met: 0, partial: 0, notShown: 1 }, preferred: { total: 0, met: 0, partial: 0, notShown: 0 } };

    const text = renderToStaticMarkup(<Requirements requirements={[requirement]} tally={tally} />).replace(/<[^>]+>/g, "");

    expect(text).toContain("Comfortable saying no");
    expect(text).not.toContain("Pushed back on a launch date");
  });
});
