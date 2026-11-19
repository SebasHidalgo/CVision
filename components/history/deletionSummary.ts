/** What deleting every hidden item did: each list's "delete all" action answers this. */
export type HiddenDeletion = {
  deleted: number;
  /** Not deleted: an interview is in a call or being scored. */
  busy: number;
  /** Not deleted: the database or the cascade failed (logged with the id). */
  failed: number;
  /** Not attempted: the time budget ran out; deleting again finishes them. */
  remaining: number;
};

export type SummaryPart = { kind: "deleted" | "busy" | "failed" | "remaining"; count: number } | { kind: "unchanged" };

/** What "delete all" says afterwards, in order: what went, then each reason something didn't. Each list words it. */
export function deletionSummary(result: HiddenDeletion): SummaryPart[] {
  const parts: SummaryPart[] = [];
  if (result.deleted > 0) parts.push({ kind: "deleted", count: result.deleted });
  if (result.busy > 0) parts.push({ kind: "busy", count: result.busy });
  if (result.failed > 0) parts.push({ kind: "failed", count: result.failed });
  if (result.remaining > 0) parts.push({ kind: "remaining", count: result.remaining });
  return parts.length > 0 ? parts : [{ kind: "unchanged" }];
}
