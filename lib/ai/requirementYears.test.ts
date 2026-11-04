import { describe, expect, it } from "vitest";
import { candidateYears, dateRanges, describeYears, yearsFromRanges, yearsIn, yearsNote, yearsStatus } from "./requirementYears";

const NOW = new Date("2026-11-04T00:00:00Z");

describe("yearsIn: the posting's minimum", () => {
  it.each([
    ["5+ years of experience in full stack software development", 5],
    ["at least 3 years of production Python", 3],
    ["3-5 years as an analyst", 3],
    ["3 to 5 years as an analyst", 3],
    ["Al menos 4 años de experiencia como analista de datos", 4],
    ["mínimo 4 años de experiencia", 4],
    ["más de 2 años en soporte", 2],
    ["has led a support team of at least five people for two or more years", 2],
    ["1+ year(s) technical engineering experience", 1],
    ["10+ years of backend engineering, with at least 3 at a senior or staff level", 10],
    ["4+ years of product management, at least 2 of them in payments", 4],
    ["Backend and platform engineer with sixteen years of experience", 16],
    ["con dieciséis años de experiencia", 16],
  ])("%s -> %d", (text, min) => {
    expect(yearsIn(text)).toBe(min);
  });

  it.each([
    "pass the Microsoft Cloud background check upon hire/transfer and every two years thereafter",
    "a monthly mobility budget and a yearly offsite",
    "Strong SQL and a cloud warehouse",
  ])("finds none in %s", (text) => {
    expect(yearsIn(text)).toBeNull();
  });
});

describe("dateRanges and yearsFromRanges", () => {
  it("reads month names in English and Spanish, numeric months, bare years and present", () => {
    expect(dateRanges("Full-Stack Developer July 2024 – November 2024", NOW)).toEqual([[2024 * 12 + 6, 2024 * 12 + 11]]);
    expect(dateRanges("Analista · enero 2020 - actualidad", NOW)).toEqual([[2020 * 12, 2026 * 12 + 11]]);
    expect(dateRanges("09/2023 - 07/2024", NOW)).toEqual([[2023 * 12 + 8, 2024 * 12 + 7]]);
    expect(dateRanges("Analista Junior 2020 - 2022", NOW)).toEqual([[2020 * 12, 2022 * 12]]);
    expect(dateRanges("Sep 2023 - Present", NOW)).toEqual([[2023 * 12 + 8, 2026 * 12 + 11]]);
  });

  it("is not fooled by a phone number", () => {
    expect(dateRanges("+506 8559-0193 | someone@example.com", NOW)).toEqual([]);
  });

  it("counts overlapping roles once", () => {
    const ranges = [...dateRanges("January 2022 – December 2022", NOW), ...dateRanges("June 2022 – June 2023", NOW)];
    expect(yearsFromRanges(ranges)).toBeCloseTo(1.5, 5);
  });
});

describe("candidateYears", () => {
  it("prefers an explicit statement to the dates", () => {
    expect(candidateYears(["Full-Stack Developer with 2+ years of experience building", "January 2018 – March 2025"], NOW)).toEqual({ candidate: 2, source: "statement" });
    expect(candidateYears(["Analista de datos con cuatro años de experiencia en comercio electrónico"], NOW)).toEqual({ candidate: 4, source: "statement" });
  });

  it("sums the quoted roles' date ranges otherwise", () => {
    const found = candidateYears(["Open-Source Software Contributor January 2025 – October 2025", "Full-Stack Developer July 2024 – November 2024", "Full-Stack Developer September 2023 – July 2024"], NOW);
    expect(found?.source).toBe("dates");
    // July 2024 is in both of the last two roles: 25 months, not 26.
    expect(found?.candidate).toBe(2.1);
  });

  it("finds nothing in quotes without either", () => {
    expect(candidateYears(["Built REST APIs in Node.js"], NOW)).toBeNull();
  });
});

describe("the years rule", () => {
  it("is met at the minimum, partial from 75% of it, missing below", () => {
    expect(yearsStatus(5, 5)).toBe("met");
    expect(yearsStatus(5, 4)).toBe("partial");
    expect(yearsStatus(5, 3.75)).toBe("partial");
    expect(yearsStatus(5, 2)).toBe("missing");
  });

  it("states both numbers", () => {
    expect(yearsNote(5, 2)).toBe("The posting asks for 5+ years; your CV shows about 2.");
    expect(describeYears(2.2)).toBe("about 2");
    expect(describeYears(2.3)).toBe("about 2.5");
  });
});
