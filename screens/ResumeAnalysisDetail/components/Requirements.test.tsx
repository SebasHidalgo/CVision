import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Requirement } from "@/lib/schemas/resumeSchema";
import { NOT_SHOWN_ADVICE, Requirements } from "./SectionParts";

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
  });
});
