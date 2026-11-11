import { describe, expect, it } from "vitest";
import { combiningMarkOf, composeLetter, composeSplitAccents, type PositionedText, withoutSpuriousSpaces } from "./pdfAccents";

const item = (str: string, x: number, width: number, y = 100, hasEOL = false): PositionedText => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
  height: 10,
  hasEOL,
});

describe("composeLetter", () => {
  it("composes only what Unicode has as one code point", () => {
    expect(composeLetter("e", "́")).toBe("é");
    expect(composeLetter("ı", "́")).toBe("í");
    expect(composeLetter("N", "̃")).toBe("Ñ");
    expect(composeLetter("c", "̧")).toBe("ç");
    expect(composeLetter("t", "́")).toBeNull();
    expect(composeLetter("B", "́")).toBeNull();
    expect(composeLetter("2", "̂")).toBeNull();
  });

  it("knows the spacing accents and the combining marks", () => {
    expect(["´", "`", "ˆ", "˜", "¨", "˚", "¸", "ˇ", "¯", "́"].map(combiningMarkOf).every(Boolean)).toBe(true);
    expect(combiningMarkOf("'")).toBeNull();
    expect(combiningMarkOf("a")).toBeNull();
  });
});

describe("composeSplitAccents", () => {
  it("composes TeX's accent-then-letter when the letter is drawn back under it", () => {
    const { items, compositions } = composeSplitAccents([item("Jos´", 100, 20), item("e Pe˜", 115, 25), item("na", 135, 10)]);
    expect(items.map((one) => one.str).join("")).toBe("José Peña");
    expect(compositions.map((one) => one.letter)).toEqual(["é", "ñ"]);
  });

  it("composes a raised accent that stands alone over a capital", () => {
    const { items } = composeSplitAccents([item("´", 101, 5, 103), item("AREA", 100, 30)]);
    expect(items.map((one) => one.str).join("")).toBe("ÁREA");
  });

  it("composes the accent drawn after its letter", () => {
    const { items } = composeSplitAccents([item("Jose", 100, 30), item("´ Perez", 127, 40)]);
    expect(items.map((one) => one.str).join("")).toBe("José Perez");
  });

  it("leaves a typed accent that advances like any glyph", () => {
    const typed = [item("don", 100, 20), item("´", 120, 5), item("t, it´s", 125, 30)];
    expect(composeSplitAccents(typed).items.map((one) => one.str).join("")).toBe("don´t, it´s");
  });

  it("leaves pieces on another line or in another column", () => {
    expect(composeSplitAccents([item("Jos´", 100, 20, 100, true), item("e", 100, 5, 86)]).compositions).toEqual([]);
    expect(composeSplitAccents([item("Jos´", 300, 20), item("e", 50, 5)]).compositions).toEqual([]);
  });

  it("notes the space pdf.js put before a mark that stood alone", () => {
    const { compositions } = composeSplitAccents([item("GESTI ", 100, 33), item("´", 133, 5, 103), item("ON", 132, 15)]);
    expect(compositions).toEqual([{ letter: "Ó", spaceBefore: { item: 0, index: 5 } }]);
  });
});

describe("withoutSpuriousSpaces", () => {
  const items = [item("GESTI ", 100, 33), item("", 133, 0), item("ÓN", 132, 15)];
  const compositions = [{ letter: "Ó", spaceBefore: { item: 0, index: 5 } }];

  it("drops the space when the glyphs say the letter touches the one before the accent", () => {
    expect(withoutSpuriousSpaces(items, compositions, [{ letter: "Ó", joined: true }]).items.map((one) => one.str).join("")).toBe("GESTIÓN");
  });

  it("keeps it for a real word gap, and keeps everything when the two lists do not line up", () => {
    expect(withoutSpuriousSpaces(items, compositions, [{ letter: "Ó", joined: false }]).removed).toBe(0);
    expect(withoutSpuriousSpaces(items, compositions, [{ letter: "É", joined: true }]).removed).toBe(0);
    expect(withoutSpuriousSpaces(items, compositions, []).removed).toBe(0);
  });
});
