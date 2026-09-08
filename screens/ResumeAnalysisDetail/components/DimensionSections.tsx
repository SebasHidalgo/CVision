import ScoreMeter from "@/components/score/ScoreMeter";
import type { ResumeAnalysisFeedback } from "@/types/resume";
import { DIMENSIONS } from "../utils/dimensions";
import {
  Chips,
  Evidence,
  MarkedList,
  NumberedList,
  Rewrites,
  Section,
  SkillEvidence,
} from "./SectionParts";

type DimensionSectionsProps = {
  feedback: ResumeAnalysisFeedback;
};

const [ATS, EXPERIENCE, SKILLS, EDUCATION, TONE, FIT] = DIMENSIONS;

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
      <Section
        id={ATS.id}
        index="01"
        label={ATS.label}
        score={atsCompatibility.score}
        description={atsCompatibility.description}
      >
        <div className="grid gap-10 md:grid-cols-2">
          <MarkedList title="What gets in the way" items={atsCompatibility.problems} mark="signal" />
          <MarkedList title="How to fix it" items={atsCompatibility.fixes} mark="strong" />
        </div>
        <Evidence items={atsCompatibility.evidence} />
      </Section>

      <Section
        id={EXPERIENCE.id}
        index="02"
        label={EXPERIENCE.label}
        score={experienceAndImpact.score}
        description={experienceAndImpact.description}
      >
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
        <Chips
          title="Missing from the CV"
          items={skills.missingSkills}
          kind="missing"
          emptyText="Nothing the posting asks for is missing."
        />
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
        score={toneAndClarity.score}
        description={toneAndClarity.description}
      >
        <div className="max-w-sm">
          <div className="flex items-baseline justify-between">
            <h3 className="eyebrow">Readability</h3>
            <span className="figure text-3xl text-ink tabular">
              {toneAndClarity.readability}
            </span>
          </div>
          <ScoreMeter
            score={toneAndClarity.readability}
            size="sm"
            label="Readability"
            className="mt-2"
          />
        </div>
        <MarkedList title="Suggestions" items={toneAndClarity.suggestions} mark="neutral" />
      </Section>

      <Section
        id={FIT.id}
        index="06"
        label={FIT.label}
        score={jobFit.score}
        description={jobFit.description}
      >
        <div className="grid gap-10 md:grid-cols-2">
          <Chips
            title="Keywords you match"
            items={jobFit.matchedKeywords}
            kind="matched"
            emptyText="No keyword from the posting appears in the CV."
          />
          <Chips
            title="Keywords you're missing"
            items={jobFit.missingKeywords}
            kind="missing"
            emptyText="Every keyword from the posting appears in the CV."
          />
        </div>
        <NumberedList title="Strategic moves" items={jobFit.strategicRecommendations} />
      </Section>
    </div>
  );
}
