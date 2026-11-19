import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSIS_TIMEOUT_MS, REPAIR_TIMEOUT_MS } from "@/lib/ai/resumeAnalysis";
import { STORAGE_TIMEOUT_MS } from "@/lib/supabase/server";
import {
  ACTION_BUDGET_MS,
  FILE_MS,
  MIN_ANALYSIS_MS,
  MODEL_CALL_MS,
  modelDeadline,
  REQUEST_LIFETIME_MS,
  SAVE_RESERVE_MS,
  SUBMISSION_WAIT_MS,
  submissionWaitUntil,
} from "./budget";

/** The upload page's maxDuration, as Next reads it: the literal in page.tsx. */
const PAGE = readFileSync(path.join(process.cwd(), "app/(root)/resume/upload/page.tsx"), "utf8");
const MAX_DURATION_MS = Number(/export const maxDuration = (\d+);/.exec(PAGE)?.[1]) * 1000;

describe("the analysis request's time budget", () => {
  it("sits inside the page's maxDuration, and a request is taken for dead only after it", () => {
    expect(MAX_DURATION_MS).toBe(100_000);
    expect(ACTION_BUDGET_MS).toBeLessThan(MAX_DURATION_MS);
    expect(REQUEST_LIFETIME_MS).toBeGreaterThan(MAX_DURATION_MS);
  });

  it("stands for the real timeouts: the download's plus a parse, and one full analysis call", () => {
    expect(FILE_MS - STORAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(MODEL_CALL_MS).toBe(ANALYSIS_TIMEOUT_MS);
  });

  it("without a deadline the slowest analysis (both optional calls at their timeouts) would not fit: the model gets one", () => {
    expect(FILE_MS + 2 * ANALYSIS_TIMEOUT_MS + REPAIR_TIMEOUT_MS + SAVE_RESERVE_MS).toBeGreaterThan(ACTION_BUDGET_MS);
  });

  it("a retry that waited the longest still fits a whole analysis before the deadline; only the optional calls give way", () => {
    expect(SUBMISSION_WAIT_MS + MIN_ANALYSIS_MS).toBeLessThanOrEqual(ACTION_BUDGET_MS);
    const start = 0;
    const deadline = start + ACTION_BUDGET_MS;
    const waited = submissionWaitUntil(start, deadline);
    expect(waited).toBe(start + SUBMISSION_WAIT_MS);
    // The file and the analysis call at their timeouts, then the save: inside the budget.
    expect(waited + FILE_MS + MODEL_CALL_MS).toBeLessThanOrEqual(modelDeadline(deadline));
    expect(modelDeadline(deadline) + SAVE_RESERVE_MS).toBe(deadline);
  });

  it("stops waiting early when the request has less left than the wait would take", () => {
    const deadline = 60_000;
    expect(submissionWaitUntil(10_000, deadline)).toBe(deadline - MIN_ANALYSIS_MS);
    expect(submissionWaitUntil(0, deadline + 1_000_000)).toBe(SUBMISSION_WAIT_MS);
  });
});
