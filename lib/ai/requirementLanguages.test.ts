import { describe, expect, it } from "vitest";
import { languagesAsked, statesLevel } from "./requirementLanguages";

const ask = (requirement: string, sourceQuote = requirement) => languagesAsked({ requirement, sourceQuote });

describe("languagesAsked", () => {
  it.each([
    ["Fluency to read, write and speak in English.", ["English"]],
    ["Working proficiency in written and spoken English.", ["English"]],
    ["good written English", ["English"]],
    ["Español nativo o C2 e inglés profesional.", ["English", "Spanish"]],
    ["Portugués.", ["Portuguese"]],
    ["German at a conversational level.", ["German"]],
  ])("%s asks for %j", (requirement, languages) => {
    expect(ask(requirement)).toEqual(languages);
  });

  it.each(["A second European language besides English, which our partners in Rotterdam use daily.", "Strong experience with Go, Java or another statically typed language."])(
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
