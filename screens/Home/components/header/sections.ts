// The landing's sections, in page order: anchor ids are language-neutral, labels live in landing.json.

export const SECTION_LINKS = [
  { id: "how-it-works", key: "header.sections.how" },
  { id: "analysis", key: "header.sections.analysis" },
  { id: "interview", key: "header.sections.interview" },
  { id: "pricing", key: "header.sections.pricing" },
  { id: "faq", key: "header.sections.faq" },
] as const;

/** The app's own pages, for a signed-in reader. */
export const APP_LINKS = [
  { href: "/resume/analyses", key: "nav.analyses" },
  { href: "/interviews", key: "nav.interviews" },
] as const;
