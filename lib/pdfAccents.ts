// Split accents put back on their letters, from where pdf.js says each piece was drawn. Pure.

/**
 * pdfTeX with the default OT1 encoding has no "é": it draws the accent, moves
 * back and draws the "e" under it. pdf.js reads the stream in order, so the
 * accent ends one item ("Jos´") and the next item starts with the letter, to
 * the left of where the accent's item ended. A typed "´" (don´t) advances like
 * any glyph and is never moved back over, so geometry tells the two apart.
 */

const SPACING_MARKS: Record<string, string> = {
  "´": "́", // ´ acute
  "ˊ": "́",
  "`": "̀", // grave
  "ˋ": "̀",
  "^": "̂", // circumflex
  "ˆ": "̂",
  "~": "̃", // tilde
  "˜": "̃",
  "¨": "̈", // ¨ diaeresis
  "˚": "̊", // ˚ ring
  "¸": "̧", // ¸ cedilla
  "ˇ": "̌", // ˇ caron
  "¯": "̄", // ¯ macron
  "ˉ": "̄",
  "˘": "̆", // ˘ breve
  "˙": "̇", // ˙ dot above
  "˝": "̋", // ˝ double acute
  "˛": "̨", // ˛ ogonek
};

// TeX accents "í" over a dotless "ı".
const DOTLESS: Record<string, string> = { "ı": "i", "ȷ": "j" };

/** The combining mark a character stands for, or null when it is not an accent. */
export function combiningMarkOf(char: string): string | null {
  if (SPACING_MARKS[char]) return SPACING_MARKS[char];
  return /^[̀-ͯ]$/.test(char) ? char : null;
}

/** The precomposed letter, or null when Unicode has no single code point for it. */
export function composeLetter(base: string, mark: string): string | null {
  const letter = DOTLESS[base] ?? base;
  if (!/^\p{L}$/u.test(letter)) return null;
  const composed = `${letter}${mark}`.normalize("NFC");
  return [...composed].length === 1 ? composed : null;
}

/** What linesOf needs from a pdf.js text item. */
export type PositionedText = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };

// A move back of less than this is rounding, not a glyph drawn over another.
const BACKWARD_EPSILON = 0.5;

const lastChar = (text: string) => [...text].at(-1) ?? "";
const firstChar = (text: string) => [...text][0] ?? "";

/** Whether b is drawn back over the end of a, on the same line: the accent and its letter. */
function drawnOver(a: PositionedText, b: PositionedText): boolean {
  if (a.hasEOL) return false;
  const size = Math.max(a.height, b.height, 1);
  const aStart = a.transform[4];
  const aEnd = aStart + a.width;
  const bStart = b.transform[4];
  const sameLine = Math.abs(a.transform[5] - b.transform[5]) <= size * 0.6;
  // Back over a's last glyph, never so far back that it is another column.
  return sameLine && bStart < aEnd - BACKWARD_EPSILON && bStart > aStart - size;
}

/** One composed accent, in stream order, and the space pdf.js put right before its mark, if any. */
export type AccentComposition = { letter: string; spaceBefore: { item: number; index: number } | null };

/**
 * The items with every split accent composed into its letter, in either
 * order (TeX draws the accent first; some generators draw it after), and the
 * compositions. Anything that would not compose to one code point is left as is.
 */
export function composeSplitAccents<T extends PositionedText>(items: T[]): { items: T[]; compositions: AccentComposition[] } {
  const out = items.map((item) => ({ ...item }));
  const compositions: AccentComposition[] = [];
  for (let i = 0; i < out.length - 1; i += 1) {
    const a = out[i];
    if (a.str === "") continue;
    let j = i + 1;
    while (j < out.length && out[j].str === "" && !out[j].hasEOL) j += 1;
    const b = out[j];
    if (!b || b.str === "" || !drawnOver(a, b)) continue;

    const before = lastChar(a.str);
    const after = firstChar(b.str);
    const markBefore = combiningMarkOf(before);
    if (markBefore) {
      const letter = composeLetter(after, markBefore);
      if (letter) {
        a.str = a.str.slice(0, -before.length);
        b.str = letter + b.str.slice(after.length);
        compositions.push({ letter, spaceBefore: spaceBeforeMark(out, i) });
        continue;
      }
    }
    const markAfter = combiningMarkOf(after);
    if (markAfter) {
      const letter = composeLetter(before, markAfter);
      if (letter) {
        a.str = a.str.slice(0, -before.length) + letter;
        b.str = b.str.slice(after.length);
        compositions.push({ letter, spaceBefore: null });
      }
    }
  }
  return { items: out, compositions };
}

/** The space just before a removed mark: the end of its own item, or of the item before a mark that stood alone. */
function spaceBeforeMark(items: PositionedText[], at: number): AccentComposition["spaceBefore"] {
  let item = at;
  while (item >= 0 && items[item].str === "") {
    item -= 1;
    if (item >= 0 && items[item].hasEOL) return null;
  }
  if (item < 0 || !items[item].str.endsWith(" ")) return null;
  return { item, index: items[item].str.length - 1 };
}

/** The pdf.js operator ids the glyph walk reads. */
export type TextOps = Record<
  | "beginText"
  | "setTextMatrix"
  | "moveText"
  | "setLeadingMoveText"
  | "setLeading"
  | "nextLine"
  | "setFont"
  | "setCharSpacing"
  | "setWordSpacing"
  | "setHScale"
  | "showText"
  | "showSpacedText"
  | "nextLineShowText"
  | "nextLineSetSpacingShowText",
  number
>;

type Glyph = { unicode: string; start: number; end: number; y: number; em: number };

/** Every glyph's horizontal extent on its line, from the text operators (no rotation assumed). */
function walkGlyphs(fnArray: number[], argsArray: unknown[][], ops: TextOps): Glyph[] {
  const glyphs: Glyph[] = [];
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  let size = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let hScale = 1;
  let leading = 0;
  const moveLine = (tx: number, ty: number) => {
    tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + tx * tlm[0] + ty * tlm[2], tlm[5] + tx * tlm[1] + ty * tlm[3]];
    tm = [...tlm];
  };
  const show = (run: unknown[]) => {
    for (const part of run) {
      const advance =
        typeof part === "number"
          ? (-part / 1000) * size * hScale
          : (((part as { width?: number }).width ?? 0) / 1000) * size * hScale + charSpacing + ((part as { isSpace?: boolean }).isSpace ? wordSpacing : 0);
      if (typeof part !== "number") {
        const start = tm[4];
        glyphs.push({ unicode: (part as { unicode?: string }).unicode ?? "", start, end: start + advance * tm[0], y: tm[5], em: size * tm[0] });
      }
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + advance * tm[0], tm[5] + advance * tm[1]];
    }
  };
  fnArray.forEach((fn, i) => {
    const args = (argsArray[i] ?? []) as unknown[];
    if (fn === ops.beginText) {
      tm = [1, 0, 0, 1, 0, 0];
      tlm = [1, 0, 0, 1, 0, 0];
    } else if (fn === ops.setTextMatrix) {
      const m = Array.from(args.length === 1 ? (args[0] as number[]) : (args as number[]));
      tm = [...m];
      tlm = [...m];
    } else if (fn === ops.moveText) moveLine(Number(args[0]), Number(args[1]));
    else if (fn === ops.setLeadingMoveText) {
      leading = -Number(args[1]);
      moveLine(Number(args[0]), Number(args[1]));
    } else if (fn === ops.setLeading) leading = Number(args[0]);
    else if (fn === ops.nextLine) moveLine(0, -leading);
    else if (fn === ops.setFont) size = Number(args[1]);
    else if (fn === ops.setCharSpacing) charSpacing = Number(args[0]);
    else if (fn === ops.setWordSpacing) wordSpacing = Number(args[0]);
    else if (fn === ops.setHScale) hScale = Number(args[0]) / 100;
    else if (fn === ops.showText || fn === ops.showSpacedText) show(args[0] as unknown[]);
    else if (fn === ops.nextLineShowText) {
      moveLine(0, -leading);
      show(args[0] as unknown[]);
    } else if (fn === ops.nextLineSetSpacingShowText) {
      wordSpacing = Number(args[0]);
      charSpacing = Number(args[1]);
      moveLine(0, -leading);
      show(args[2] as unknown[]);
    }
  });
  return glyphs;
}

// Closer than this to the glyph before it, a letter is in the same word: a space pdf.js put there is spurious.
const SAME_WORD_GAP_EM = 0.1;

/**
 * The split accents of a page in stream order, each with whether its letter
 * touches the glyph before the accent. pdf.js turns the accent's centering
 * shift over a wide capital into a space ("GESTI ÓN"); this says when it is one.
 */
export function accentJoins(fnArray: number[], argsArray: unknown[][], ops: TextOps): { letter: string; joined: boolean }[] {
  const glyphs = walkGlyphs(fnArray, argsArray, ops);
  const events: { letter: string; joined: boolean }[] = [];
  const back = (later: Glyph, earlier: Glyph) => later.start < earlier.end - BACKWARD_EPSILON / 10;
  for (let i = 0; i < glyphs.length; i += 1) {
    const mark = combiningMarkOf(glyphs[i].unicode);
    if (!mark) continue;
    // TeX's order first: the mark, then its letter drawn back under it.
    const next = glyphs[i + 1];
    const forward = next && back(next, glyphs[i]) ? composeLetter(next.unicode, mark) : null;
    if (forward) {
      const previous = glyphs[i - 1];
      const sameLine = previous && Math.abs(previous.y - next.y) < next.em * 0.6;
      events.push({ letter: forward, joined: Boolean(sameLine && next.start - previous.end < next.em * SAME_WORD_GAP_EM) });
      i += 1;
      continue;
    }
    const previous = glyphs[i - 1];
    const backward = previous && back(glyphs[i], previous) ? composeLetter(previous.unicode, mark) : null;
    if (backward) events.push({ letter: backward, joined: false });
  }
  return events;
}

/** The items without the spaces pdf.js put inside a word before an accent; untouched unless every composition lines up. */
export function withoutSpuriousSpaces<T extends PositionedText>(
  items: T[],
  compositions: AccentComposition[],
  joins: { letter: string; joined: boolean }[],
): { items: T[]; removed: number } {
  const aligned = compositions.length === joins.length && compositions.every((one, k) => one.letter === joins[k].letter);
  if (!aligned) return { items, removed: 0 };
  const out = items.map((item) => ({ ...item }));
  let removed = 0;
  compositions.forEach((composition, k) => {
    const space = composition.spaceBefore;
    if (!joins[k].joined || !space || out[space.item].str[space.index] !== " ") return;
    out[space.item].str = out[space.item].str.slice(0, space.index) + out[space.item].str.slice(space.index + 1);
    removed += 1;
  });
  return { items: out, removed };
}
