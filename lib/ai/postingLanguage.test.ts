import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectPostingLanguage, proseLanguage } from "./postingLanguage";

// The versioned eval postings: written in English except the one Spanish
// posting; one English posting is paired with a Spanish CV, which must not
// matter here.
const FIXTURES = path.join(process.cwd(), "scripts", "eval", "fixtures");
const SPANISH_POSTINGS = new Set(["es-posting"]);

describe("detectPostingLanguage", () => {
  it("reads every eval fixture posting in the language it was written in", () => {
    const names = readdirSync(FIXTURES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const job = readFileSync(path.join(FIXTURES, name, "job.txt"), "utf8");
      expect(detectPostingLanguage(job), name).toBe(SPANISH_POSTINGS.has(name) ? "es" : "en");
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

describe("proseLanguage", () => {
  it("reads English prose that names Spanish places and companies as English", () => {
    expect(proseLanguage("Your role at Asociación Corazón Abierto in Valparaíso shows the React work the posting asks for, and your degree from the Universidad de España is relevant.")).toBe("en");
  });

  it("reads Spanish prose as Spanish, whatever its length", () => {
    expect(proseLanguage(`${"Your skills section is clear. ".repeat(30)} Tu experiencia es sólida para el puesto y los proyectos de la empresa muestran que trabajas con el equipo en las funciones del cargo y con los clientes de la región.`)).toBe("en");
    expect(proseLanguage("Tu experiencia es sólida para el puesto y los proyectos de la empresa muestran que trabajas con el equipo.")).toBe("es");
  });
});
