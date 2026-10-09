import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectPostingLanguage } from "./postingLanguage";

// The versioned eval postings: all written in English, one of them paired
// with a Spanish CV, which must not matter here.
const FIXTURES = path.join(process.cwd(), "scripts", "eval", "fixtures");

describe("detectPostingLanguage", () => {
  it("reads every eval fixture posting as English", () => {
    const names = readdirSync(FIXTURES);
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const job = readFileSync(path.join(FIXTURES, name, "job.txt"), "utf8");
      expect(detectPostingLanguage(job), name).toBe("en");
    }
  });

  it("reads a Spanish posting as Spanish, English tool names included", () => {
    const posting =
      "Buscamos un desarrollador frontend senior para sumarse a nuestro equipo en San José. " +
      "Requisitos: 5 años de experiencia con React y TypeScript, conocimientos de Next.js y testing, " +
      "inglés conversacional. Funciones: desarrollo de nuevas features, revisión de código y mentoría " +
      "de los perfiles junior de la empresa.";

    expect(detectPostingLanguage(posting)).toBe("es");
  });

  it("defaults to English for empty text and for a bare list of tool names", () => {
    expect(detectPostingLanguage("")).toBe("en");
    expect(
      detectPostingLanguage("React, TypeScript, Next.js, Node, PostgreSQL, Docker, AWS"),
    ).toBe("en");
  });

  it("judges the opening few hundred characters, so a bilingual posting goes with whichever comes first", () => {
    const english =
      "We are looking for a senior engineer to join our team. You will work with the product team and own the checkout flow. ".repeat(
        6,
      );
    const spanish =
      "Buscamos un ingeniero senior para el equipo de producto, con experiencia en los flujos de pago y conocimientos de la plataforma. ".repeat(
        6,
      );

    expect(detectPostingLanguage(english + spanish)).toBe("en");
    expect(detectPostingLanguage(spanish + english)).toBe("es");
  });
});
