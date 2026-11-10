// The sentences code writes into an analysis. Always English today; Spanish waits for a user-chosen language. Pure.

export type AnalysisLanguage = "en" | "es";

type Wording = {
  and: string;
  or: string;
  downgrade: string;
  shownButNot: (shown: string, absent: string) => string;
  noneOf: (absent: string) => string;
  notShown: (absent: string) => string;
  years: (min: number, about: string) => string;
  yearsTotal: (min: number, about: string) => string;
  about: (value: string) => string;
  alternative: (absent: string, several: boolean, accepts: string) => string;
  contextOnly: (shown: string, several: boolean) => string;
  languageLevel: (language: string) => string;
  coreGaps: (list: string) => string;
  partlyMet: (list: string) => string;
  allMet: string;
  noGapsNotShown: (count: number) => string;
  yearsLabel: (min: number) => string;
  showsOf: (met: number, total: number) => string;
  moreInList: (count: number) => string;
  forInterview: (count: number) => string;
  preferredNotShown: (list: string) => string;
  notShownAsAsked: (label: string) => string;
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
    yearsTotal: (min, about) => `The posting asks for ${min}+ years; your CV shows ${about} in total.`,
    about: (value) => `about ${value}`,
    alternative: (absent, several, accepts) =>
      `${absent} ${several ? "aren't" : "isn't"} in your CV; the posting accepts ${accepts} — say so in your cover letter.`,
    contextOnly: (shown, several) => `Your CV shows ${shown}, but the posting mentions ${several ? "them" : "it"} only as context, not as this requirement.`,
    languageLevel: (language) => `Your CV doesn't state your ${language} level. Add a Languages line, e.g. 'Spanish (native), English (C1)'.`,
    coreGaps: (list) => `Core gaps: ${list}.`,
    partlyMet: (list) => `Partly met: ${list}.`,
    allMet: "You meet every required qualification.",
    noGapsNotShown: (count) => `No core gaps; ${count} required ${count === 1 ? "item isn't" : "items aren't"} shown in your CV.`,
    yearsLabel: (min) => `${min}+ years of experience`,
    showsOf: (met, total) =>
      total === 1
        ? `Your CV ${met ? "fully shows" : "doesn't fully show"} the one required qualification a CV can show.`
        : `Your CV fully shows ${met} of the ${total} required qualifications a CV can show.`,
    moreInList: (count) => `${count} more ${count === 1 ? "gap is" : "gaps are"} in the list below.`,
    forInterview: (count) => `${count === 1 ? "One required item" : `${count} required items`} no CV can show ${count === 1 ? "is" : "are"} under "Not shown in your CV"; expect ${count === 1 ? "it" : "them"} in the interview or the hiring process.`,
    preferredNotShown: (list) => `Preferred and not shown: ${list}.`,
    notShownAsAsked: (label) => `Not shown as asked: ${label}.`,
  },
  es: {
    and: "y",
    or: "o",
    downgrade: "Ninguna línea de tu CV lo muestra, así que no cuenta como cumplido.",
    shownButNot: (shown, absent) => `Tu CV muestra ${shown}, pero no ${absent}.`,
    noneOf: (absent) => `Tu CV no muestra ninguno de estos: ${absent}.`,
    notShown: (absent) => `Tu CV no muestra ${absent}.`,
    years: (min, about) => `La oferta pide ${min}+ años; tu CV muestra ${about}.`,
    yearsTotal: (min, about) => `La oferta pide ${min}+ años; tu CV muestra ${about} en total.`,
    about: (value) => `unos ${value}`,
    alternative: (absent, several, accepts) =>
      `${absent} no ${several ? "aparecen" : "aparece"} en tu CV; la oferta acepta ${accepts}: dilo en tu carta de presentación.`,
    contextOnly: (shown, several) => `Tu CV muestra ${shown}, pero la oferta ${several ? "los" : "lo"} menciona solo como contexto, no como este requisito.`,
    languageLevel: (language) => `Tu CV no indica tu nivel de ${language}. Agrega una línea de idiomas, por ejemplo 'Español (nativo), inglés (C1)'.`,
    coreGaps: (list) => `Brechas principales: ${list}.`,
    partlyMet: (list) => `Cumplido en parte: ${list}.`,
    allMet: "Cumples todos los requisitos obligatorios.",
    noGapsNotShown: (count) =>
      `Sin brechas principales; ${count} ${count === 1 ? "requisito obligatorio no aparece" : "requisitos obligatorios no aparecen"} en tu CV.`,
    yearsLabel: (min) => `${min}+ años de experiencia`,
    showsOf: (met, total) =>
      total === 1
        ? `Tu CV ${met ? "muestra por completo" : "no muestra por completo"} el único requisito obligatorio que un CV puede mostrar.`
        : `Tu CV muestra por completo ${met} de los ${total} requisitos obligatorios que un CV puede mostrar.`,
    moreInList: (count) => `${count} ${count === 1 ? "brecha más está" : "brechas más están"} en la lista de abajo.`,
    forInterview: (count) => `${count === 1 ? "Un requisito obligatorio" : `${count} requisitos obligatorios`} que ningún CV puede mostrar ${count === 1 ? "está" : "están"} en "No aparece en tu CV"; espéralos en la entrevista o en el proceso de selección.`,
    preferredNotShown: (list) => `Deseables que no aparecen: ${list}.`,
    notShownAsAsked: (label) => `No aparece como se pide: ${label}.`,
  },
};
