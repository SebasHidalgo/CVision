import type { InterviewFeedbackReport } from "@/lib/ai/schemas";
import type { ResumeAnalysisFeedback } from "@/lib/schemas/resumeSchema";

/**
 * The prose the model wrote, by path: the only text that is ever translated. Never translated: CV
 * quotes and evidence, posting lines (requirement titles, sourceQuote), key terms and their CV words,
 * skill names, roles, companies, figures, ATS sections and artifacts, and suggested bullets (they go
 * into the user's CV, in the CV's language). Code-made sentences are data, rendered per language
 * (lib/i18n/sentences.ts), except on rows stored before they were: there the headline, the outcome
 * sentences and the code's notes are part of the stored text and are translated with it. Pure.
 */
export type ProseMap = Record<string, string>;

const put = (map: ProseMap, path: string, text: string | undefined) => {
  if (text && text.trim()) map[path] = text;
};

export function analysisProse(feedback: ResumeAnalysisFeedback): ProseMap {
  const map: ProseMap = {};
  const { overall, atsCompatibility: ats, experienceAndImpact: experience, skills, educationAndCertifications: education, toneAndClarity: tone, jobFit } = feedback;
  put(map, "overall.summaryText", overall.summaryText);
  overall.prioritizedFixes.forEach((fix, i) => {
    put(map, `overall.prioritizedFixes.${i}.title`, fix.title);
    put(map, `overall.prioritizedFixes.${i}.action`, fix.action);
  });
  put(map, "atsCompatibility.description", ats.description);
  ats.problems.forEach((text, i) => put(map, `atsCompatibility.problems.${i}`, text));
  ats.fixes.forEach((text, i) => put(map, `atsCompatibility.fixes.${i}`, text));
  put(map, "experienceAndImpact.description", experience.description);
  experience.strengths.forEach((text, i) => put(map, `experienceAndImpact.strengths.${i}`, text));
  experience.weaknesses.forEach((text, i) => put(map, `experienceAndImpact.weaknesses.${i}`, text));
  put(map, "skills.description", skills.description);
  skills.actionPlan.forEach((text, i) => put(map, `skills.actionPlan.${i}`, text));
  put(map, "educationAndCertifications.description", education.description);
  education.highlights.forEach((text, i) => put(map, `educationAndCertifications.highlights.${i}`, text));
  education.improvements.forEach((text, i) => put(map, `educationAndCertifications.improvements.${i}`, text));
  put(map, "toneAndClarity.description", tone.description);
  tone.suggestions.forEach((text, i) => put(map, `toneAndClarity.suggestions.${i}`, text));
  put(map, "jobFit.description", jobFit.description);
  jobFit.strategicRecommendations.forEach((text, i) => put(map, `jobFit.strategicRecommendations.${i}`, text));
  // A note code wrote is data (noteSentences); only the model's own note is prose.
  jobFit.requirements.forEach((requirement, i) => {
    if (!requirement.noteSentences) put(map, `jobFit.requirements.${i}.note`, requirement.note);
  });
  return map;
}

export function feedbackProse(report: InterviewFeedbackReport): ProseMap {
  const map: ProseMap = {};
  report.gapFollowThrough.forEach((row, i) => put(map, `gapFollowThrough.${i}.note`, row.note));
  report.notableAnswers.forEach((answer, i) => put(map, `notableAnswers.${i}.why`, answer.why));
  report.categoryScores.forEach((category, i) => put(map, `categoryScores.${i}.comment`, category.comment));
  report.strengths.forEach((point, i) => put(map, `strengths.${i}.point`, point.point));
  report.areasForImprovement.forEach((point, i) => put(map, `areasForImprovement.${i}.point`, point.point));
  put(map, "finalAssessment", report.finalAssessment);
  return map;
}

/** The same object with the translated strings written at their paths; paths not in the map keep the original. */
export function withProse<T>(value: T, translated: ProseMap): T {
  const copy = structuredClone(value) as Record<string, unknown>;
  for (const [path, text] of Object.entries(translated)) {
    const keys = path.split(".");
    let at: unknown = copy;
    for (const key of keys.slice(0, -1)) at = at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined;
    const last = keys[keys.length - 1];
    // Only a string that exists is replaced: a stale path never adds a field.
    if (at && typeof at === "object" && typeof (at as Record<string, unknown>)[last] === "string") (at as Record<string, unknown>)[last] = text;
  }
  return copy as T;
}
