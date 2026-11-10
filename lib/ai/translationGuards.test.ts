import { describe, expect, it } from "vitest";
import { checkTranslation, guardTranslations, quotedSpans } from "./translationGuards";

const SOURCE = "Add a figure to \"Led the migration\": your CV shows 2.5 years of Python and 40% fewer incidents.";

describe("checkTranslation", () => {
  it("passes a faithful translation, decimal comma included", () => {
    const es = "Agrega una cifra a \"Led the migration\": tu CV muestra 2,5 años de Python y 40% menos incidentes.";
    expect(checkTranslation(SOURCE, es, ["Python"])).toEqual([]);
  });

  it("fails a changed figure, a translated protected term and an altered quote", () => {
    expect(checkTranslation(SOURCE, "Agrega una cifra a \"Led the migration\": tu CV muestra 3 años de Python y 40% menos incidentes.", ["Python"])).toContain("digits");
    expect(checkTranslation("You use Ruby on Rails daily.", "Usas Ruby sobre Rieles a diario.", ["Ruby on Rails"])).toContain("protected-term");
    expect(checkTranslation(SOURCE, "Agrega una cifra a «Dirigí la migración»: tu CV muestra 2,5 años de Python y 40% menos incidentes.", ["Python"])).toContain("quote");
  });

  it("matches protected terms as whole tokens, case-sensitively", () => {
    expect(checkTranslation("Go is listed.", "Google aparece.", ["Go"])).toContain("protected-term");
    expect(checkTranslation("Write in plain English here.", "Escribe en un inglés sencillo aquí.", ["Go"])).toEqual([]);
  });

  it("fails what is missing, empty, far off in length or left in English", () => {
    expect(checkTranslation(SOURCE, undefined, [])).toEqual(["missing"]);
    expect(checkTranslation(SOURCE, "   ", [])).toEqual(["empty"]);
    expect(checkTranslation(SOURCE, "Sí.", [])).toContain("length");
    expect(checkTranslation("Your summary names the role and the stack clearly.", "Your summary names the role and the stack clearly.", [])).toEqual(["unchanged"]);
  });
});

describe("quotedSpans", () => {
  it("reads straight, curly and angle quotes, and leaves apostrophes alone", () => {
    expect(quotedSpans(`It says "React" and “Node.js” and ‘SQL’ and «Go» and 'Docker', but doesn't quote "x".`)).toEqual(["React", "Node.js", "SQL", "Go", "Docker"]);
    expect(quotedSpans("The CV doesn't say it's the team's choice.")).toEqual([]);
  });
});

describe("guardTranslations", () => {
  it("keeps what passes, reports the rest by path and check, and counts terms and digits", () => {
    const sources = { a: "Your CV shows Python for 3 years.", b: "Quantify the 40% drop in \"incidents\"." };
    const translated = { a: "Tu CV muestra Python durante 3 años.", b: "Cuantifica la baja del 50% en «incidentes»." };
    const { kept, stats } = guardTranslations(sources, translated, ["Python"]);
    expect(kept).toEqual({ a: "Tu CV muestra Python durante 3 años." });
    expect(stats).toMatchObject({ strings: 2, kept: 1, counts: { digits: 1, quote: 1 }, protectedTerms: { present: 1, preserved: 1 }, digits: { present: 2, preserved: 1 } });
    expect(stats.failures).toEqual([{ path: "b", check: "digits" }, { path: "b", check: "quote" }]);
    // No text in the stats: they are stored and logged.
    expect(JSON.stringify(stats)).not.toContain("incidentes");
  });
});
