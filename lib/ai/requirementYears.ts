import { WORDING, type AnalysisLanguage } from "@/lib/ai/analysisWording";
import type { RequirementStatus } from "@/lib/schemas/resumeSchema";

// M8-C: years thresholds decided in code. Pure; tested.

/** At or above the minimum is met; from this share of it, partial; below, missing. */
export const YEARS_PARTIAL_SHARE = 0.75;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, "dieciséis": 16,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30,
};

const NUMBER = `(\\d+(?:[.,]\\d+)?|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|")})`;
const YEARS_WORD = `(?:years?|yrs?|años|año)(?:\\(s\\))?`;

// "5+ years", "3-5 years", "at least 3 years", "two or more years", "mínimo 4 años", "más de 2 años"; never "every two years".
const YEARS_PATTERN = new RegExp(
  `(?<![\\p{L}\\d])(every\\s+|cada\\s+)?(?:(?:at\\s+least|a\\s+minimum\\s+of|minimum(?:\\s+of)?|over|more\\s+than|al\\s+menos|por\\s+lo\\s+menos|m[ií]nimo(?:\\s+de)?|m[aá]s\\s+de)\\s+)?${NUMBER}\\s*(?:\\+|(?:-|–|—|to|a)\\s*\\d+)?\\s*(?:or\\s+more\\s+|o\\s+m[aá]s\\s+)?${YEARS_WORD}(?![\\p{L}])`,
  "giu",
);

const toNumber = (text: string): number | null => {
  const word = NUMBER_WORDS[text.toLowerCase()];
  if (word !== undefined) return word;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

/** The first years figure in a text, the lower bound of a range; null when there is none. */
export function yearsIn(text: string): number | null {
  for (const match of text.matchAll(YEARS_PATTERN)) {
    if (match[1]) continue;
    const value = toNumber(match[2]);
    if (value !== null && value > 0 && value < 60) return value;
  }
  return null;
}

// After the figure: "of (professional) experience"; before it: "experience of".
const EXPERIENCE_AFTER = /^\s*(?:of\s+|de\s+)?(?:[\p{L}-]+\s+){0,2}?(?:experience|experiencia)(?![\p{L}])/iu;
const EXPERIENCE_BEFORE = /(?:experience|experiencia)\s+(?:of|de)\s*$/iu;

/** A total stated in words ("2+ years of experience", "cuatro años de experiencia"); not "six years on JVM services". */
export function totalExperienceIn(text: string): number | null {
  for (const match of text.matchAll(YEARS_PATTERN)) {
    if (match[1] || match.index === undefined) continue;
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 60);
    const before = text.slice(Math.max(0, match.index - 30), match.index);
    if (!EXPERIENCE_AFTER.test(after) && !EXPERIENCE_BEFORE.test(before)) continue;
    const value = toNumber(match[2]);
    if (value !== null && value > 0 && value < 60) return value;
  }
  return null;
}

/** The clause a requirement's years figure sits in: from the figure to the next comma, semicolon or sentence end. */
export function yearsClauseIn(text: string): string {
  for (const match of text.matchAll(YEARS_PATTERN)) {
    if (match[1] || match.index === undefined) continue;
    const rest = text.slice(match.index);
    const end = rest.search(/[,;]|\.(?:\s|$)/);
    return end < 0 ? rest : rest.slice(0, end);
  }
  return "";
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
  ene: 1, enero: 1, febrero: 2, marzo: 3, abr: 4, abril: 4, mayo: 5, junio: 6, julio: 7, ago: 8,
  agosto: 8, set: 9, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, dic: 12, diciembre: 12,
};

const MONTH = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|")})\\.?`;
const DATE = `(?:${MONTH}\\s+(?:de\\s+)?(\\d{4})|(\\d{1,2})[/.](\\d{4})|(\\d{4}))`;
const PRESENT = "(present|current|now|today|ongoing|actualidad|presente|actual|hoy|la\\s+fecha)";
const RANGE_PATTERN = new RegExp(
  `(?<![\\p{L}\\d])${DATE}\\s*(?:-|–|—|to|until|a|al|hasta)\\s*(?:${DATE}|${PRESENT})(?![\\p{L}\\d])`,
  "giu",
);

type Point = { year: number; month: number | null };

function pointOf(groups: (string | undefined)[]): Point | null {
  const [monthName, monthYear, numMonth, numYear, bareYear] = groups;
  if (monthName && monthYear) return { year: Number(monthYear), month: MONTHS[monthName.toLowerCase()] ?? null };
  if (numMonth && numYear) {
    const month = Number(numMonth);
    return month >= 1 && month <= 12 ? { year: Number(numYear), month } : null;
  }
  if (bareYear) return { year: Number(bareYear), month: null };
  return null;
}

/** Month intervals [start, end) of every date range in the text; a bare year counts from January. */
export function dateRanges(text: string, now: Date): [number, number][] {
  const ranges: [number, number][] = [];
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (const match of text.matchAll(RANGE_PATTERN)) {
    const start = pointOf(match.slice(1, 6));
    // A phone number reads as "8559-0193"; a year outside a working life is not a date.
    if (!start || start.year < 1950 || start.year > now.getUTCFullYear()) continue;
    const startIndex = start.year * 12 + (start.month ?? 1) - 1;
    let endIndex: number;
    if (match[11]) {
      endIndex = nowIndex + 1;
    } else {
      const end = pointOf(match.slice(6, 11));
      if (!end) continue;
      // An end month counts in full; a bare end year counts up to its January.
      endIndex = end.year * 12 + (end.month === null ? 0 : end.month);
    }
    endIndex = Math.min(endIndex, nowIndex + 1);
    if (endIndex > startIndex) ranges.push([startIndex, endIndex]);
  }
  return ranges;
}

/** Total years in the ranges, overlaps counted once. */
export function yearsFromRanges(ranges: [number, number][]): number {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let months = 0;
  let current: [number, number] | null = null;
  for (const range of sorted) {
    if (current && range[0] <= current[1]) {
      current[1] = Math.max(current[1], range[1]);
    } else {
      if (current) months += current[1] - current[0];
      current = [range[0], range[1]];
    }
  }
  if (current) months += current[1] - current[0];
  return months / 12;
}

export type CandidateYears = { candidate: number; source: "statement" | "dates" };

/** An explicit statement in the quotes wins; otherwise the sum of their date ranges. */
export function candidateYears(quotes: string[], now: Date): CandidateYears | null {
  for (const quote of quotes) {
    const stated = yearsIn(quote);
    if (stated !== null) return { candidate: stated, source: "statement" };
  }
  const ranges = quotes.flatMap((quote) => dateRanges(quote, now));
  if (ranges.length === 0) return null;
  return { candidate: Math.round(yearsFromRanges(ranges) * 10) / 10, source: "dates" };
}

export function yearsStatus(min: number, candidate: number): RequirementStatus {
  if (candidate >= min) return "met";
  if (candidate >= YEARS_PARTIAL_SHARE * min) return "partial";
  return "missing";
}

/** "about 2", "about 2.5": halves are the precision a CV supports. */
export function describeYears(value: number, language: AnalysisLanguage = "en"): string {
  const rounded = Math.round(value * 2) / 2;
  return WORDING[language].about(rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1));
}

export function yearsNote(min: number, candidate: number, language: AnalysisLanguage = "en"): string {
  return WORDING[language].years(min, describeYears(candidate, language));
}

/** The text without its date ranges: a role line "Full-Stack Developer July 2021 – November 2021" reads "Full-Stack Developer". */
export function withoutDateRanges(text: string): string {
  return text.replace(RANGE_PATTERN, " ");
}
