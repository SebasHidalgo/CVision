import { ResumeAnalysis } from "@/types/resume";
import React from "react";

type ResumeAnalysisProps = {
  resumeAnalysis: ResumeAnalysis;
};

export default function ResumeAnalysisContent({
  resumeAnalysis,
}: ResumeAnalysisProps) {
  return (
    <>
      {resumeAnalysis.companyName} - {resumeAnalysis.jobTitle}
      <div>ats</div>
      description: {resumeAnalysis.feedback.atsCompatibility.description}
      score: {resumeAnalysis.feedback.atsCompatibility.score}
      highlights:{" "}
      {resumeAnalysis.feedback.atsCompatibility.highlights.map((h, i) => (
        <div key={i}>{h}</div>
      ))}
      tips:{" "}
      {resumeAnalysis.feedback.atsCompatibility.tips.map((t, i) => (
        <div key={i}>
          {t.description} - {t.type}
        </div>
      ))}

------------------------------------
      <div>eduuuu</div>
      description: {resumeAnalysis.feedback.education.description}
      score: {resumeAnalysis.feedback.education.score}
      highlights:{" "}
      {resumeAnalysis.feedback.education.highlights.map((h, i) => (
        <div key={i}>{h}</div>
      ))}
      tips:{" "}
      {resumeAnalysis.feedback.education.tips.map((t, i) => (
        <div key={i}>
          {t.description} - {t.type}
        </div>
      ))}

      ------------------------------------
      <div>experience</div>
      description: {resumeAnalysis.feedback.experience.description}
      score: {resumeAnalysis.feedback.experience.score}
      highlights:{" "}
      {resumeAnalysis.feedback.experience.highlights.map((h, i) => (
        <div key={i}>{h}</div>
      ))}
      tips:{" "}
      {resumeAnalysis.feedback.experience.tips.map((t, i) => (
        <div key={i}>
          {t.description} - {t.type}
        </div>
      ))}

 ------------------------------------
      <div>skills</div>
      description: {resumeAnalysis.feedback.skills.description}
      score: {resumeAnalysis.feedback.skills.score}
      highlights:{" "}
      {resumeAnalysis.feedback.skills.highlights.map((h, i) => (
        <div key={i}>{h}</div>
      ))}
      tips:{" "}
      {resumeAnalysis.feedback.skills.tips.map((t, i) => (
        <div key={i}>
          {t.description} - {t.type}
        </div>
      ))}

        missing skills: {resumeAnalysis.feedback.skills.missingSkills.join(", ")}
        matched skills: {resumeAnalysis.feedback.skills.matchedSkills.join(", ")}


------------------------------------
      <div>eduutoneAndLanguageuu</div>
      description: {resumeAnalysis.feedback.toneAndLanguage.description}
      score: {resumeAnalysis.feedback.toneAndLanguage.score}
      highlights:{" "}
      {resumeAnalysis.feedback.toneAndLanguage.highlights.map((h, i) => (
        <div key={i}>{h}</div>
      ))}
      tips:{" "}
      {resumeAnalysis.feedback.toneAndLanguage.tips.map((t, i) => (
        <div key={i}>
          {t.description} - {t.type}
        </div>
      ))}

        tone: {resumeAnalysis.feedback.toneAndLanguage.tone}
        readabilityScore: {resumeAnalysis.feedback.toneAndLanguage.readabilityScore}

      ------------------------------------
      <div>job aligment</div>
      description: {resumeAnalysis.feedback.jobDescriptionAlignment.description}
      score: {resumeAnalysis.feedback.jobDescriptionAlignment.score}
      highlights:{" "}
      {resumeAnalysis.feedback.jobDescriptionAlignment.highlights.map((h, i) => (
        <div key={i}>{h}</div>
      ))}
      tips:{" "}
      {resumeAnalysis.feedback.jobDescriptionAlignment.tips.map((t, i) => (
        <div key={i}>
          {t.description} - {t.type}
        </div>
      ))}

        matched keywords:{" "}
        {resumeAnalysis.feedback.jobDescriptionAlignment.matchedKeywords.join(
          ", "
        )}
        missing keywords:{" "}
        {resumeAnalysis.feedback.jobDescriptionAlignment.missingKeywords.join(
          ", "
        )}


--------------------------------------
        <div>overall</div>
        global score: {resumeAnalysis.feedback.overall.globalScore}
        verdict: {resumeAnalysis.feedback.overall.verdict}
        summary text: {resumeAnalysis.feedback.overall.summaryText}
        tips:{" "}
        {resumeAnalysis.feedback.overall.tips.map((t, i) => (
          <div key={i}>
            {t.description} - {t.type}
          </div>
        ))}
    </>
  );
}
