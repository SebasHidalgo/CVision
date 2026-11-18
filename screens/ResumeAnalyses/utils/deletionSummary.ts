import type { HiddenDeletion } from "@/screens/ResumeAnalyses/actions/deleteHiddenAnalysesAction";

export type SummaryPart = { key: "result.deleted" | "result.busy" | "result.failed" | "result.remaining"; count: number } | { key: "result.unchanged" };

/** What "delete all" says afterwards, in order: what went, then each reason something didn't. */
export function deletionSummary(result: HiddenDeletion): SummaryPart[] {
  const parts: SummaryPart[] = [];
  if (result.deleted > 0) parts.push({ key: "result.deleted", count: result.deleted });
  if (result.busy > 0) parts.push({ key: "result.busy", count: result.busy });
  if (result.failed > 0) parts.push({ key: "result.failed", count: result.failed });
  if (result.remaining > 0) parts.push({ key: "result.remaining", count: result.remaining });
  return parts.length > 0 ? parts : [{ key: "result.unchanged" }];
}
