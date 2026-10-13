import { RESUME_KEY_PREFIX } from "@/lib/supabase/resumeKey";
import type { StoredObject } from "@/lib/supabase/server";

/**
 * An upload in progress has an object and no row yet: the row arrives when
 * the analysis action finishes, seconds later. A day is generous cover for
 * that, and for an abandoned tab.
 */
export const ORPHAN_GRACE_HOURS = 24;

export type Verdict =
  | { kind: "keep"; why: "referenced" | "recent" | "unknown-age" }
  | { kind: "orphan"; why: "no-row" | "outside-cv" };

export type Classified = StoredObject & { verdict: Verdict };

/**
 * What to do with each object in the bucket. Referenced by a row: keep.
 * Under `cv/` with no row: an orphan once it is older than the grace; kept
 * while younger, or when the listing gave no age to judge by. Anything
 * outside `cv/` was never written by this code and has no row by
 * construction: an orphan, whatever its age.
 */
export function classifyObjects(
  objects: readonly StoredObject[],
  referencedKeys: ReadonlySet<string>,
  now: Date,
): Classified[] {
  const graceMs = ORPHAN_GRACE_HOURS * 60 * 60 * 1000;

  return objects.map((object) => {
    if (referencedKeys.has(object.key)) return { ...object, verdict: { kind: "keep", why: "referenced" } };
    if (!object.key.startsWith(RESUME_KEY_PREFIX)) {
      return { ...object, verdict: { kind: "orphan", why: "outside-cv" } };
    }
    if (object.createdAt === null) return { ...object, verdict: { kind: "keep", why: "unknown-age" } };
    if (now.getTime() - object.createdAt.getTime() < graceMs) {
      return { ...object, verdict: { kind: "keep", why: "recent" } };
    }
    return { ...object, verdict: { kind: "orphan", why: "no-row" } };
  });
}

/** Keys a row still references that are not in the bucket: the other kind of orphan. */
export function missingObjects(objects: readonly StoredObject[], referencedKeys: ReadonlySet<string>): string[] {
  const present = new Set(objects.map((object) => object.key));
  return [...referencedKeys].filter((key) => !present.has(key)).sort();
}
