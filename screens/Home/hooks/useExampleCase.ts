"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CV_LINES, REQUIREMENTS, type CaseKind, type CaseStatus, type CvLineKind, type RequirementId, type TermId } from "@/screens/Home/utils/exampleCase";

export type LocalizedRequirement = {
  id: RequirementId;
  n: string;
  kind: CaseKind;
  kindLabel: string;
  status: CaseStatus;
  statusLabel: string;
  statusShort: string;
  line: number | null;
  /** Short name for the figure and legend. */
  label: string;
  /** The posting's words. */
  text: string;
  /** What the CV line shows, when one proves it. */
  evidence: string | null;
  note: string;
  terms: { id: TermId; name: string; found: boolean }[][];
};

export type LocalizedCvLine = { n: number; kind: CvLineKind; text: string };

/** The example case with its strings in the reader's language. */
export function useExampleCase() {
  const { t, i18n } = useTranslation("landing");
  return useMemo(() => {
    const requirements: LocalizedRequirement[] = REQUIREMENTS.map((r) => ({
      id: r.id,
      n: r.n,
      kind: r.kind,
      kindLabel: t(`case.kind.${r.kind}`),
      status: r.status,
      statusLabel: t(`case.status.${r.status}`),
      statusShort: t(`case.statusShort.${r.status}`),
      line: r.line,
      label: t(`case.req.${r.id}.label`),
      text: t(`case.req.${r.id}.text`),
      evidence: r.line ? t(`case.req.${r.id}.evidence`, { defaultValue: "" }) || null : null,
      note: t(`case.req.${r.id}.note`),
      terms: (r.terms ?? []).map((group) => group.map((term) => ({ id: term.id, name: t(`case.terms.${term.id}`), found: term.found }))),
    }));
    const cvLines: LocalizedCvLine[] = CV_LINES.map((l) => ({ n: l.n, kind: l.kind, text: t(`case.cv.${l.id}`) }));
    return {
      company: t("case.company"),
      role: t("case.role"),
      candidate: t("case.candidate"),
      file: t("case.file"),
      requirements,
      cvLines,
    };
    // The language is the only input that changes the strings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, i18n.language]);
}
