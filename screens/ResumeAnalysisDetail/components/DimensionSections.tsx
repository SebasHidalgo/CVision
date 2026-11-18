import { getT } from "@/lib/i18n/server";
import { requirementTally } from "@/lib/schemas/resumeSchema";
import type { ResumeAnalysisFeedback } from "@/types/resume";
import { DIMENSION_IDS, type DimensionId } from "../utils/dimensions";
import { Requirements } from "./Requirements";
import {
  Achievements,
  Evidence,
  ListPair,
  MarkedList,
  NumberedList,
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
  const { atsCompatibility, experienceAndImpact, skills, educationAndCertifications, toneAndClarity, jobFit } = feedback;
  const total = String(DIMENSION_IDS.length).padStart(2, "0");
  const head = (id: DimensionId, score: number | null, description: string) => ({
    id,
    index: String(DIMENSION_IDS.indexOf(id) + 1).padStart(2, "0"),
    total,
    label: t(`dimensions.${id}.label`),
    score,
    description,
    common,
  });

  return (
    <div>
      {/* The requirements breakdown leads: it is the question the user came with. */}
      <Section {...head("fit", null, jobFit.description)}>
        <Requirements requirements={jobFit.requirements} tally={requirementTally(feedback)} t={t} />
        <NumberedList title={t("sections.strategicMoves")} items={jobFit.strategicRecommendations} />
      </Section>

      <Section {...head("experience", experienceAndImpact.score, experienceAndImpact.description)}>
        <Achievements achievements={experienceAndImpact.quantifiedAchievements} t={t} />
        <ListPair
          lists={[
            { title: t("sections.strengths"), items: experienceAndImpact.strengths, mark: "strong" },
            { title: t("sections.weakSpots"), items: experienceAndImpact.weaknesses, mark: "weak" },
          ]}
        />
        <Rewrites bullets={experienceAndImpact.suggestedBullets} t={t} />
      </Section>

      <Section {...head("skills", skills.score, skills.description)}>
        <SkillEvidence skills={skills.matchedSkills} t={t} />
        <NumberedList title={t("sections.actionPlan")} items={skills.actionPlan} />
      </Section>

      <Section {...head("education", educationAndCertifications.score, educationAndCertifications.description)}>
        <ListPair
          lists={[
            { title: t("sections.highlights"), items: educationAndCertifications.highlights, mark: "strong" },
            { title: t("sections.improvements"), items: educationAndCertifications.improvements, mark: "weak" },
          ]}
        />
      </Section>

      <Section {...head("tone", null, toneAndClarity.description)}>
        <MarkedList title={t("sections.suggestions")} items={toneAndClarity.suggestions} mark="neutral" />
      </Section>

      <Section {...head("ats", null, atsCompatibility.description)}>
        <TextLayer artifacts={atsCompatibility.encodingArtifacts} sections={atsCompatibility.sectionsDetected} t={t} />
        <ListPair
          lists={[
            { title: t("sections.atsProblems"), items: atsCompatibility.problems, mark: "weak" },
            { title: t("sections.atsFixes"), items: atsCompatibility.fixes, mark: "strong" },
          ]}
        />
        <Evidence items={atsCompatibility.evidence} t={t} />
      </Section>
    </div>
  );
}
