import { requirementTally } from "@/lib/schemas/resumeSchema";
import type { ResumeAnalysisFeedback } from "@/types/resume";
import { DIMENSIONS } from "../utils/dimensions";
import {
  Achievements,
  Chips,
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

const [FIT, EXPERIENCE, SKILLS, EDUCATION, TONE, ATS] = DIMENSIONS;

export default function DimensionSections({ feedback }: DimensionSectionsProps) {
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
        id={FIT.id}
        index="01"
        label={FIT.label}
        score={null}
        description={jobFit.description}
      >
        <Requirements
          requirements={jobFit.requirements}
          tally={requirementTally(feedback)}
        />
        <NumberedList title="Strategic moves" items={jobFit.strategicRecommendations} />
      </Section>

      <Section
        id={EXPERIENCE.id}
        index="02"
        label={EXPERIENCE.label}
        score={experienceAndImpact.score}
        description={experienceAndImpact.description}
      >
        <Achievements achievements={experienceAndImpact.quantifiedAchievements} />
        <div className="grid gap-10 md:grid-cols-2">
          <MarkedList title="Strengths" items={experienceAndImpact.strengths} mark="strong" />
          <MarkedList title="Weak spots" items={experienceAndImpact.weaknesses} mark="signal" />
        </div>
        <Rewrites bullets={experienceAndImpact.suggestedBullets} />
      </Section>

      <Section
        id={SKILLS.id}
        index="03"
        label={SKILLS.label}
        score={skills.score}
        description={skills.description}
      >
        <SkillEvidence skills={skills.matchedSkills} />
        <NumberedList title="Action plan" items={skills.actionPlan} />
      </Section>

      <Section
        id={EDUCATION.id}
        index="04"
        label={EDUCATION.label}
        score={educationAndCertifications.score}
        description={educationAndCertifications.description}
      >
        <div className="grid gap-10 md:grid-cols-2">
          <MarkedList title="Highlights" items={educationAndCertifications.highlights} mark="strong" />
          <MarkedList title="Improvements" items={educationAndCertifications.improvements} mark="signal" />
        </div>
        {educationAndCertifications.recommendedCerts.length > 0 && (
          <Chips
            title="Worth adding"
            items={educationAndCertifications.recommendedCerts}
            kind="neutral"
          />
        )}
      </Section>

      <Section
        id={TONE.id}
        index="05"
        label={TONE.label}
        score={null}
        description={toneAndClarity.description}
      >
        <MarkedList title="Suggestions" items={toneAndClarity.suggestions} mark="neutral" />
      </Section>

      <Section
        id={ATS.id}
        index="06"
        label={ATS.label}
        score={null}
        description={atsCompatibility.description}
      >
        <TextLayer
          artifacts={atsCompatibility.encodingArtifacts}
          sections={atsCompatibility.sectionsDetected}
        />
        <div className="grid gap-10 md:grid-cols-2">
          <MarkedList title="What gets in the way" items={atsCompatibility.problems} mark="signal" />
          <MarkedList title="How to fix it" items={atsCompatibility.fixes} mark="strong" />
        </div>
        <Evidence items={atsCompatibility.evidence} />
      </Section>
    </div>
  );
}
