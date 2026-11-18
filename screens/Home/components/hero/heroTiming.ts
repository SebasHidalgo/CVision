import { CV_LINES, REQUIREMENTS, type CaseRequirement } from "@/screens/Home/utils/exampleCase";

// The hero's reading, in seconds from its start. Shared by the 3D scene and the HTML figure; no three.js here, so the
// page can import it without pulling the scene chunk.

/** The scan line enters the CV at T_SCAN0 and leaves it at T_SCAN1. */
export const T_SCAN0 = 0.7;
export const T_SCAN1 = 4.1;
/** How long a status takes to land (the connector draws, the mark fills). */
export const DRAW = 0.45;
/** When the requirements no CV line proves are filed, one after the other. */
export const T_REST = 4.35;
/** Gap between two of those late filings. */
export const LATE_STEP = 0.15;

/** 3D only: a requirement's flight from the field onto its sheet. */
export const FLIGHT = 0.95;
/** 3D only: when the requirement sheet's rules draw. */
export const T_RULES = 4.9;
/** 3D only: when everything has landed and the scene can stop drawing every frame. */
export const SETTLED = T_REST + LATE_STEP + FLIGHT + 0.5;

/** A scene averaging more than this per frame (s) over its first 45 frames drops to 1x resolution. */
export const SLOW_FRAME = 0.045;

/** When the scan reaches a proving requirement's CV line; the late filing time for the others. */
export function startTimes(reqs: readonly CaseRequirement[] = REQUIREMENTS, lineCount = CV_LINES.length): number[] {
  let late = 0;
  return reqs.map((r) => {
    if (r.line === null || (r.status !== "met" && r.status !== "partial")) {
      const t = T_REST + late * LATE_STEP;
      late += 1;
      return t;
    }
    const index = r.line - 1;
    return T_SCAN0 + (index / Math.max(1, lineCount - 1)) * (T_SCAN1 - T_SCAN0);
  });
}

/** A requirement a CV line proves: met or partly met, with a line. */
export function proves(r: CaseRequirement): boolean {
  return r.line !== null && (r.status === "met" || r.status === "partial");
}
