"use client";

import { createContext, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ANSWERED_GAPS, type RequirementId } from "@/screens/Home/utils/exampleCase";
import { useExampleCase, type LocalizedCvLine, type LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { GAP_OUTCOMES, type AnsweredGapId, type StepId } from "./storyData";

/** How a figure is drawn: the moving object (every variant present, cross-fading) or a still of one step. */
export type FigureMode = "stage" | "still";

export const FigureContext = createContext<{ mode: FigureMode; step: StepId }>({ mode: "still", step: "posting" });
export const useFigure = () => useContext(FigureContext);

export type StoryCase = {
  company: string;
  role: string;
  file: string;
  requirements: Record<RequirementId, LocalizedRequirement>;
  cvLines: LocalizedCvLine[];
  /** The answers the example interview gave on its two gaps: when, what was said, how it went. */
  gaps: Partial<Record<RequirementId, { at: number; quote: string; outcome: string }>>;
};

export const StoryCaseContext = createContext<StoryCase | null>(null);

export function useStoryCase(): StoryCase {
  const value = useContext(StoryCaseContext);
  if (!value) throw new Error("useStoryCase outside <Story>");
  return value;
}

/** The example case in the reader's language, read once for the whole section. */
export function useStoryCaseValue(): StoryCase {
  const example = useExampleCase();
  const { t } = useTranslation("landing");
  return useMemo(() => {
    const gaps: StoryCase["gaps"] = {};
    for (const gap of ANSWERED_GAPS) {
      const id: AnsweredGapId = gap.req;
      gaps[id] = { at: gap.at, quote: t(`case.answers.${id}`), outcome: t(`case.outcome.${GAP_OUTCOMES[id]}`) };
    }
    return {
      company: example.company,
      role: example.role,
      file: example.file,
      requirements: Object.fromEntries(example.requirements.map((r) => [r.id, r])) as Record<RequirementId, LocalizedRequirement>,
      cvLines: example.cvLines,
      gaps,
    };
  }, [example, t]);
}
