import { getT } from "@/lib/i18n/server";
import { requirementTally } from "@/lib/schemas/resumeSchema";
import type { ResumeAnalysisFeedback } from "@/types/resume";
import {
  Achievements,
  Evidence,
  MarkedList,
  NumberedList,
  Requirements,
  Rewrites,
  Section,
  SkillEvidence,
  TextLayer,
} from "./SectionParts";

type DimensionSectionsProps = {
  feedback: ResumeAnalysisFeedback;
};

export default async function DimensionSections({ feedback }: DimensionSectionsProps) {
  const [t, common] = await Promise.all([getT("analysis"), getT("common")]);
  const {
    atsCompatibility,
    experienceAndImpact,
    skills,
    educationAndCertifications,
    toneAndClarity,
    jobFit,
  } = feedback;

  return (
    <div>
      {/* The requirements breakdown leads: it is the question the user came with. */}
      <Section
        id="fit"
        index="01"
        label={t("dimensions.fit.label")}
        score={null}
        description={jobFit.description}
        common={common}
      >
        <Requirements
          requirements={jobFit.requirements}
          tally={requirementTally(feedback)}
          t={t}
        />
        <NumberedList title={t("sections.strategicMoves")} items={jobFit.strategicRecommendations} />
      </Section>

      <Section
        id="experience"
        index="02"
        label={t("dimensions.experience.label")}
        score={experienceAndImpact.score}
        description={experienceAndImpact.description}
        common={common}
      >
        <Achievements achievements={experienceAndImpact.quantifiedAchievements} t={t} />
        <div className="grid gap-10 md:grid-cols-2">
          <MarkedList title={t("sections.strengths")} items={experienceAndImpact.strengths} mark="strong" />
          <MarkedList title={t("sections.weakSpots")} items={experienceAndImpact.weaknesses} mark="signal" />
        </div>
        <Rewrites bullets={experienceAndImpact.suggestedBullets} t={t} />
      </Section>

      <Section
        id="skills"
        index="03"
        label={t("dimensions.skills.label")}
        score={skills.score}
        description={skills.description}
        common={common}
      >
        <SkillEvidence skills={skills.matchedSkills} t={t} />
        <NumberedList title={t("sections.actionPlan")} items={skills.actionPlan} />
      </Section>

      <Section
        id="education"
        index="04"
        label={t("dimensions.education.label")}
        score={educationAndCertifications.score}
        description={educationAndCertifications.description}
        common={common}
      >
        <div className="grid gap-10 md:grid-cols-2">
          <MarkedList title={t("sections.highlights")} items={educationAndCertifications.highlights} mark="strong" />
          <MarkedList title={t("sections.improvements")} items={educationAndCertifications.improvements} mark="signal" />
        </div>
      </Section>

      <Section
        id="tone"
        index="05"
        label={t("dimensions.tone.label")}
        score={null}
        description={toneAndClarity.description}
        common={common}
      >
        <MarkedList title={t("sections.suggestions")} items={toneAndClarity.suggestions} mark="neutral" />
      </Section>

      <Section
        id="ats"
        index="06"
        label={t("dimensions.ats.label")}
        score={null}
        description={atsCompatibility.description}
        common={common}
      >
        <TextLayer
          artifacts={atsCompatibility.encodingArtifacts}
          sections={atsCompatibility.sectionsDetected}
          t={t}
        />
        <div className="grid gap-10 md:grid-cols-2">
          <MarkedList title={t("sections.atsProblems")} items={atsCompatibility.problems} mark="signal" />
          <MarkedList title={t("sections.atsFixes")} items={atsCompatibility.fixes} mark="strong" />
        </div>
        <Evidence items={atsCompatibility.evidence} t={t} />
      </Section>
    </div>
  );
}
