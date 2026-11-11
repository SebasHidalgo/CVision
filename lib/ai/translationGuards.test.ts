import { describe, expect, it } from "vitest";
import { carriedThrough, checkTerm, checkTranslation, fixInstructions, isHard, quotedSpans, type GuardContext } from "./translationGuards";

const SOURCE = "Add a figure to \"Led the migration\": your CV shows 2.5 years of Python and 40% fewer incidents.";

const ctx = (over: Partial<GuardContext> = {}): GuardContext => ({ locale: "es", names: ["Python"], concepts: [], labels: new Map(), ...over });
const checks = (source: string, text: string | undefined, context = ctx()) => checkTranslation(source, text, context).map((f) => f.check);

describe("checkTranslation", () => {
  it("passes a faithful translation, decimal comma included", () => {
    const es = "Agrega una cifra a \"Led the migration\": tu CV muestra 2,5 años de Python y 40% menos incidentes.";
    expect(checks(SOURCE, es)).toEqual([]);
  });

  it("fails a changed figure, a translated name and an altered quote", () => {
    expect(checks(SOURCE, "Agrega una cifra a \"Led the migration\": tu CV muestra 3 años de Python y 40% menos incidentes.")).toContain("digits");
    expect(checks("You use Ruby on Rails daily.", "Usas Ruby sobre Rieles a diario.", ctx({ names: ["Ruby on Rails"] }))).toContain("name");
    expect(checks(SOURCE, "Agrega una cifra a «Dirigí la migración»: tu CV muestra 2,5 años de Python y 40% menos incidentes.")).toContain("quote");
  });

  it("lets a quoted interface label take its label in the target language", () => {
    const labels = new Map([["Not shown in your CV", "No aparece en tu CV"]]);
    const source = 'One required item is under "Not shown in your CV"; expect it in the interview.';
    expect(checks(source, 'Un requisito está en "No aparece en tu CV"; espéralo en la entrevista.', ctx({ labels }))).toEqual([]);
    expect(checks(source, 'Un requisito está en "No se muestra"; espéralo en la entrevista.', ctx({ labels }))).toEqual(["quote"]);
    // The retry says how the label reads.
    expect(fixInstructions(checkTranslation(source, 'Un requisito está en "No se muestra"; espéralo.', ctx({ labels })))[0]).toContain('write it as "No aparece en tu CV"');
  });

  it("matches names as whole tokens, case-sensitively", () => {
    expect(checks("Go is listed.", "Google aparece.", ctx({ names: ["Go"] }))).toContain("name");
    expect(checks("Write in plain English here.", "Escribe en un inglés sencillo aquí.", ctx({ names: ["Go"] }))).toEqual([]);
  });

  it("fails what is missing, empty, far off in length or left in English", () => {
    expect(checks(SOURCE, undefined)).toEqual(["missing"]);
    expect(checks(SOURCE, "   ")).toEqual(["empty"]);
    expect(checks(SOURCE, "Sí.")).toContain("length");
    expect(checks("Your summary names the role and the stack clearly.", "Your summary names the role and the stack clearly.")).toEqual(["unchanged"]);
  });

  it("accepts a string of only names and figures that reads the same in both languages", () => {
    expect(checks("React, TypeScript, Next.js (2021)", "React, TypeScript, Next.js (2021)", ctx({ names: ["React", "TypeScript", "Next.js"] }))).toEqual([]);
  });

  it("fails a short title returned as it was, and an answer with an English sentence left inside", () => {
    expect(checks("Highlight Cloud Experience", "Highlight Cloud Experience")).toEqual(["unchanged"]);
    const source = "Education and certifications are clearly presented with the dates. The degree is relevant to the role.";
    const half = "Education and certifications are clearly presented with the dates. El título es afín al puesto.";
    expect(checks(source, half)).toEqual(["english-left"]);
    // English quoted from the CV, or a name with "and" in it, is not English left behind.
    const quoting = 'Tu viñeta "Led the migration of the billing service to the cloud" muestra impacto en Ethereum and Smart Contracts.';
    expect(checks('Your bullet "Led the migration of the billing service to the cloud" shows impact in Ethereum and Smart Contracts.', quoting, ctx({ names: ["Ethereum and Smart Contracts"] }))).toEqual([]);
  });

  it("flags a concept left in English and the third person, as soft checks", () => {
    const concepts = [{ term: "software architecture", text: "arquitectura de software" }, { term: "stack", text: "stack" }];
    const failed = checkTranslation("Your CV shows software architecture.", "Su CV muestra Software Architecture.", ctx({ concepts }));
    expect(failed.map((f) => f.check)).toEqual(["english-term", "third-person"]);
    expect(failed.every((f) => !isHard(f))).toBe(true);
    expect(failed[0].items).toEqual(["software architecture → arquitectura de software"]);
    // A concept inside a name is not English left behind.
    expect(checks("Data pipelines on Azure Data Factory.", "Pipelines de datos en Azure Data Factory.", ctx({ names: ["Azure Data Factory"], concepts: [{ term: "data", text: "datos" }] }))).toEqual([]);
  });
});

describe("checkTerm", () => {
  it("wants a translation that keeps figures and inner names, and is not left as it was", () => {
    expect(checkTerm("schema design", "diseño de esquemas", [])).toEqual([]);
    expect(checkTerm("experience with React", "experiencia con Reacción", ["React"]).map((f) => f.check)).toEqual(["name"]);
    expect(checkTerm("5+ years", "más de cinco años", []).map((f) => f.check)).toEqual(["digits"]);
    expect(checkTerm("Computer Science", "Computer Science", []).map((f) => f.check)).toEqual(["unchanged"]);
    // One word may read the same ("software", "BSc"), and a term already in Spanish needs nothing.
    expect(checkTerm("software", "software", [])).toEqual([]);
    expect(checkTerm("comercio electrónico", "comercio electrónico", [], "es")).toEqual([]);
  });
});

describe("quotedSpans", () => {
  it("reads straight, curly and angle quotes, and leaves apostrophes alone", () => {
    expect(quotedSpans(`It says "React" and “Node.js” and ‘SQL’ and «Go» and 'Docker', but doesn't quote "x".`)).toEqual(["React", "Node.js", "SQL", "Go", "Docker"]);
    expect(quotedSpans("The CV doesn't say it's the team's choice.")).toEqual([]);
  });
});

describe("carriedThrough", () => {
  it("counts names and digit groups in the final strings, the English original where one fell back", () => {
    const sources = { a: "Your CV shows Python for 3 years.", b: "Quantify the 40% drop." };
    const result = carriedThrough(sources, { a: "Tu CV muestra Python durante 3 años." }, ["Python"]);
    expect(result).toEqual({ protectedTerms: { present: 1, preserved: 1 }, digits: { present: 2, preserved: 2 } });
  });
});
