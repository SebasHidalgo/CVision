import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "./pdfParse";

// The corpus in scripts/eval/accents/: one Jake's-resume-style CV compiled five ways, and a Chromium page.
const CORPUS = path.resolve(__dirname, "../scripts/eval/accents");
const read = async (name: string) => extractPdfText(new Uint8Array(readFileSync(path.join(CORPUS, `${name}.pdf`))));

const WORDS = [
  "José Ñandú Pérez",
  "Señor de la Peña 12, São Paulo",
  "ÑANDÚ STUDIO",
  "Universidad Politécnica de España",
  "Ingeniería en Matemáticas Aplicadas",
  "INGENIERÍA DE SOFTWARE",
  "Diplôme en Informatique, Être et Crème",
  "Asociación Corazón Abierto",
  "Valparaíso",
  "Pingüino campaign and the Ação Solidária",
  "Français and Português",
  "GESTIÓN, INFORMACIÓN, MÉXICO, ÚLTIMO",
  "Álvaro, Óscar, Ángel, Íñigo",
  "ÁREA DE DATOS",
  "Español (nativo), Français (B2), Português (Ação básica)",
];
const UNCHANGED = ["don´t, it´s, I´m, O´Brien, D´Angelo, L´Oréal", "lone ´ between", "C++", "~/path/to/repo", "x^2 + y^2", "a~b"];

describe.each([
  ["pdflatex-ot1", 52],
  ["pdflatex-ot1-gentounicode", 52],
  ["pdflatex-t1", 0],
  ["xelatex", 0],
  ["lualatex", 0],
])("%s", (name, composed) => {
  it("reads every accented word, keeps the typed accents and code, and counts the compositions", async () => {
    const { text, accentsComposed } = await read(name);
    for (const words of [...WORDS, ...UNCHANGED]) expect(text).toContain(words);
    expect(accentsComposed).toBe(composed);
  });
});

describe("chromium", () => {
  it("is left exactly as the text layer has it", async () => {
    const { text, accentsComposed } = await read("chromium");
    expect(accentsComposed).toBe(0);
    for (const words of ["don´t, it´s, I´m, O´Brien, D´Angelo, L´Oréal", "a ` b, a ^ b, a ~ b, a ¨ b, a ¸ b, a ˇ b, a ¯ b, a ˚ b", "Pingüino", "Ação"]) {
      expect(text).toContain(words);
    }
  });
});
