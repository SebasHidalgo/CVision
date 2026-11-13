import { describe, expect, it } from "vitest";
import { categoryLanguagesInCv, languageCategory, namesLanguage, languagesAsked, statesLevel } from "./requirementLanguages";

const ask = (requirement: string, sourceQuote = requirement) => languagesAsked({ requirement, sourceQuote });

describe("languagesAsked", () => {
  it.each([
    ["Fluency to speak, read and write in English.", ["English"]],
    ["Working proficiency in written and spoken English.", ["English"]],
    ["Español nativo o C2 e inglés profesional.", ["English", "Spanish"]],
    ["Portugués.", ["Portuguese"]],
    ["Inglés profesional", ["English"]],
    ["German at a conversational level.", ["German"]],
  ])("%s asks for %j", (requirement, languages) => {
    expect(ask(requirement)).toEqual(languages);
  });

  it.each([
    "A second European language besides English, which our partners in Rotterdam use daily.",
    "Strong experience with Go, Java or another statically typed language.",
    // Writing in a language is not a level (M8-E scope): the model judges it.
    "writes clearly in English and Spanish",
    "good written English",
  ])(
    "%s is not about a level",
    (requirement) => {
      expect(ask(requirement)).toEqual([]);
    },
  );
});

describe("statesLevel", () => {
  it.each([
    ["Italian (native), English (fluent), Dutch (A2).", "English"],
    ["Español (nativo), inglés (C1), portugués (B1).", "English"],
    ["Español (nativo), inglés (C1), portugués (B1).", "Portuguese"],
    ["LANGUAGES\nEnglish (C2)\nGerman (B1,\nconversational)", "German"],
    ["English (native), Spanish (B2, written and spoken).", "Spanish"],
    ["Fluent English and basic French", "English"],
    ["Inglés avanzado", "English"],
    ["TOEFL iBT 105 (English)", "English"],
  ])("finds a level in %j for %s", (cv, language) => {
    expect(statesLevel(cv, language)).toBe(true);
  });

  it.each([
    // English is named, its level is not.
    ["• Added English and Spanish screens to the booking app, with a light/dark theme", "English"],
    // A neighbour's level is not this language's.
    ["Español (nativo), inglés, portugués (B1).", "English"],
    ["Languages: TypeScript, JavaScript, Go, SQL", "English"],
  ])("finds none in %j for %s", (cv, language) => {
    expect(statesLevel(cv, language)).toBe(false);
  });
});

describe("languageCategory: a key term that names a kind of language, not one language", () => {
  it.each([
    ["Another European language", true],
    ["European language", true],
    ["a second European language", true],
    ["otro idioma europeo", true],
    ["idiomas europeos", true],
    ["another language", false],
    ["a second language", false],
    ["a foreign language", false],
    ["additional languages", false],
    ["idioma extranjero", false],
    ["segundo idioma", false],
    ["otra lengua", false],
    ["idiomas adicionales", false],
  ])("reads %j as a category (European only: %s)", (term, european) => {
    expect(languageCategory(term)).toEqual({ european });
  });

  it.each(["Portuguese", "Fluent English", "inglés avanzado", "programming language", "query language", "lenguaje de programación", "languages"])("does not read %j as one", (term) => {
    expect(languageCategory(term)).toBeNull();
  });

  it("reads the bare noun from the posting's own phrase", () => {
    expect(languageCategory("language", "Another European language is a plus.")).toEqual({ european: true });
    expect(languageCategory("idioma", "Se valora un segundo idioma.")).toEqual({ european: false });
    expect(languageCategory("language", "Strong written language skills.")).toBeNull();
  });
});

describe("categoryLanguagesInCv: the CV's stated languages answer the category", () => {
  const POSTING = "We are hiring an analyst. Fluent English; our working language is English. Another European language is a plus.";
  const CV = "IDIOMAS\nEspañol (nativo), inglés (C1), portugués (B1).";

  it("answers with the stated languages that are not ones the posting already works in, in the CV's order", () => {
    expect(categoryLanguagesInCv({ category: { european: true }, cvText: CV, jobText: POSTING })).toEqual([{ name: "Spanish", word: "Español" }, { name: "Portuguese", word: "portugués" }]);
  });

  it("does not let English answer 'another language' when the posting requires English", () => {
    expect(categoryLanguagesInCv({ category: { european: false }, cvText: "Languages: English (native).", jobText: POSTING })).toEqual([]);
  });

  it("does not count the language the posting is written in, even unnamed", () => {
    const posting = "We are looking for a designer to join our team. You will work with the product team and a second language is a plus.";
    expect(categoryLanguagesInCv({ category: { european: false }, cvText: "Languages: English (native).", jobText: posting })).toEqual([]);
    expect(categoryLanguagesInCv({ category: { european: false }, cvText: "Languages: English (native), German (B2).", jobText: posting })).toEqual([{ name: "German", word: "German" }]);
  });

  it("keeps a non-European language out of a European category and in an open one", () => {
    const cv = "Languages: English (C1), Japanese (fluent).";
    expect(categoryLanguagesInCv({ category: { european: true }, cvText: cv, jobText: POSTING })).toEqual([]);
    expect(categoryLanguagesInCv({ category: { european: false }, cvText: cv, jobText: POSTING })).toEqual([{ name: "Japanese", word: "Japanese" }]);
  });

  it("needs a stated level, like every language claim", () => {
    expect(categoryLanguagesInCv({ category: { european: true }, cvText: "Worked with the French team on the rollout.", jobText: POSTING })).toEqual([]);
  });

  it("knows a language word when it sees one", () => {
    expect(namesLanguage("inglés (C1)")).toBe(true);
    expect(namesLanguage("Power BI")).toBe(false);
  });
});
