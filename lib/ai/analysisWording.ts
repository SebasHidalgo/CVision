// The sentences code writes into an analysis, in the language the model wrote it in. Pure.

export type AnalysisLanguage = "en" | "es";

type Wording = {
  and: string;
  or: string;
  downgrade: string;
  shownButNot: (shown: string, absent: string) => string;
  noneOf: (absent: string) => string;
  notShown: (absent: string) => string;
  years: (min: number, about: string) => string;
  about: (value: string) => string;
  alternative: (absent: string, several: boolean, accepts: string) => string;
  cvLanguage: (language: string) => string;
  languageName: Record<AnalysisLanguage, string>;
  coreGaps: (list: string) => string;
  partlyMet: (list: string) => string;
  allMet: string;
  yearsLabel: (min: number) => string;
};

export const WORDING: Record<AnalysisLanguage, Wording> = {
  en: {
    and: "and",
    or: "or",
    downgrade: "No line in your CV could be quoted for this, so it isn't counted as met.",
    shownButNot: (shown, absent) => `Your CV shows ${shown} but not ${absent}.`,
    noneOf: (absent) => `Your CV doesn't show any of ${absent}.`,
    notShown: (absent) => `Your CV doesn't show ${absent}.`,
    years: (min, about) => `The posting asks for ${min}+ years; your CV shows ${about}.`,
    about: (value) => `about ${value}`,
    alternative: (absent, several, accepts) =>
      `${absent} ${several ? "aren't" : "isn't"} in your CV; the posting accepts ${accepts} — say so in your cover letter.`,
    cvLanguage: (language) => `Your CV is written in ${language}, which shows it.`,
    languageName: { en: "English", es: "Spanish" },
    coreGaps: (list) => `Core gaps: ${list}.`,
    partlyMet: (list) => `Partly met: ${list}.`,
    allMet: "You meet every required qualification.",
    yearsLabel: (min) => `${min}+ years of experience`,
  },
  es: {
    and: "y",
    or: "o",
    downgrade: "Ninguna línea de tu CV lo muestra, así que no cuenta como cumplido.",
    shownButNot: (shown, absent) => `Tu CV muestra ${shown}, pero no ${absent}.`,
    noneOf: (absent) => `Tu CV no muestra ninguno de estos: ${absent}.`,
    notShown: (absent) => `Tu CV no muestra ${absent}.`,
    years: (min, about) => `La oferta pide ${min}+ años; tu CV muestra ${about}.`,
    about: (value) => `unos ${value}`,
    alternative: (absent, several, accepts) =>
      `${absent} no ${several ? "aparecen" : "aparece"} en tu CV; la oferta acepta ${accepts}: dilo en tu carta de presentación.`,
    cvLanguage: (language) => `Tu CV está escrito en ${language}, y eso lo demuestra.`,
    languageName: { en: "inglés", es: "español" },
    coreGaps: (list) => `Brechas principales: ${list}.`,
    partlyMet: (list) => `Cumplido en parte: ${list}.`,
    allMet: "Cumples todos los requisitos obligatorios.",
    yearsLabel: (min) => `${min}+ años de experiencia`,
  },
};
