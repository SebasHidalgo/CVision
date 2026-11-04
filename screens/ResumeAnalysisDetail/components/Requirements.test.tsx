import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import { NOT_SHOWN_ADVICE, Requirements, SKILLS_ONLY_ADVICE } from "./SectionParts";

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
      ...row("Strong expertise in Ruby on Rails and MySQL", "required", "partial"),
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

  it("lists only the shown alternatives of an 'any' requirement, and the advice only when flagged", () => {
    const requirement: Requirement = {
      ...row("Coding in C, C++ or Python", "required", "met"),
      evidence: "Languages: C++",
      evidenceSource: "skills",
      skillsOnly: false,
      keyTerms: { mode: "any", terms: [{ term: "C", cvMatch: "" }, { term: "C++", cvMatch: "C++" }, { term: "Python", cvMatch: "" }] },
    };
    const tally = { required: { total: 1, met: 1, partial: 0, notShown: 0 }, preferred: { total: 0, met: 0, partial: 0, notShown: 0 } };

    const text = renderToStaticMarkup(<Requirements requirements={[requirement]} tally={tally} />).replace(/<[^>]+>/g, "");

    expect(text).toContain("C++shown in your CV");
    expect(text).not.toContain("not in your CV");
    expect(text).not.toContain(SKILLS_ONLY_ADVICE);
  });
});
