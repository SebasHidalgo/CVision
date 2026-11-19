import type { ErrorCode, ErrorMeta } from "@/lib/error/errors";
import type { ResumeDetails } from "@/lib/schemas/resumeSchema";
import { RESUME_OBJECT_CACHE_CONTROL } from "@/lib/supabase/resumeKey";
import type { ActionResult } from "@/types/action";
import type { ResumeUpload } from "../actions/createResumeUploadAction";

export type UploadStage = "uploading" | "analyzing";

export type UploadFlowResult =
  | { ok: true; resumeId: string }
  | { ok: false; code: ErrorCode; stage: UploadStage; meta?: ErrorMeta };

export type PutOutcome = {
  status: number;
  /**
   * The platform's own code from the JSON body, when there is one. Storage
   * answers a refused upload with HTTP 400 and the real code inside:
   * "413" for too large, "415" for a type the bucket does not allow.
   */
  code: string | null;
};

export type UploadFlowDeps = {
  file: File;
  details: ResumeDetails;
  /** Names this submission to the server: the same key on a retry of it (`submissionKeyFor`). */
  submissionKey: string;
  /** Server action: a key and a signed URL. */
  createUpload: () => Promise<ActionResult<ResumeUpload>>;
  /** Server action: analyze the object under the key. */
  analyze: (input: ResumeDetails & { resumeKey: string; submissionKey: string }) => Promise<ActionResult<{ resumeId: string }>>;
  /** The PUT itself; `putResumeFile` by default, a stub in tests. */
  putFile?: (url: string, file: File) => Promise<PutOutcome>;
  onStage?: (stage: UploadStage) => void;
};

/**
 * The browser's PUT to the signed URL: the file, its type and the cache
 * policy the object is stored with, nothing else. No Supabase key travels;
 * the token in the URL is the authorization. A failure here is reported by
 * its code and never reaches the analysis.
 */
export async function putResumeFile(url: string, file: File): Promise<PutOutcome> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/pdf", "cache-control": RESUME_OBJECT_CACHE_CONTROL },
    body: file,
  });
  if (response.ok) return { status: response.status, code: null };
  const body = (await response.json().catch(() => null)) as { statusCode?: unknown } | null;
  return {
    status: response.status,
    code: typeof body?.statusCode === "string" ? body.statusCode : null,
  };
}

/** A sent submission and the key it was sent under. */
export type Submission = { key: string; details: ResumeDetails; file: File };

/** The same fields and the same file; a re-pick of the same file from disk is the same file. */
function isSameSubmission(last: Submission, details: ResumeDetails, file: File): boolean {
  return (
    last.details.companyName === details.companyName &&
    last.details.jobTitle === details.jobTitle &&
    last.details.jobDescription === details.jobDescription &&
    last.file.name === file.name &&
    last.file.size === file.size &&
    last.file.type === file.type &&
    last.file.lastModified === file.lastModified
  );
}

/**
 * The key for what is being sent now: the last submission's again when this repeats it (a retry after a
 * failure, whose first request may have saved the analysis), a new one when anything changed. `last` is
 * cleared once a submission opens its analysis.
 */
export function submissionKeyFor(last: Submission | null, details: ResumeDetails, file: File, mint: () => string = newSubmissionKey): string {
  return last && isSameSubmission(last, details, file) ? last.key : mint();
}

/** A random UUID. `crypto.randomUUID` exists only in secure contexts; plain http on a LAN address builds one from random bytes. */
export function newSubmissionKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** What a failed PUT means. The bucket enforces type and size on its side. */
function uploadFailureCode({ status, code }: PutOutcome): ErrorCode {
  const platformCode = code ?? String(status);
  if (platformCode === "413") return "FILE_TOO_LARGE";
  if (platformCode === "415") return "NOT_A_PDF";
  return "UPLOAD_FAILED";
}

/**
 * The whole client flow, in order: a place to upload, the upload, the
 * analysis. Each step reports its own failure and stops the ones after it:
 * a failed PUT never calls the analysis, so no server function runs for a
 * file that is not there. A thrown action (network, stale deployment) is
 * `REQUEST_FAILED`, as everywhere else.
 */
export async function runResumeUpload({
  file,
  details,
  submissionKey,
  createUpload,
  analyze,
  putFile = putResumeFile,
  onStage,
}: UploadFlowDeps): Promise<UploadFlowResult> {
  onStage?.("uploading");

  let upload: ActionResult<ResumeUpload>;
  try {
    upload = await createUpload();
  } catch {
    return { ok: false, code: "REQUEST_FAILED", stage: "uploading" };
  }
  if (!upload.ok) return { ok: false, code: upload.code, stage: "uploading", ...(upload.meta ? { meta: upload.meta } : {}) };

  let put: PutOutcome;
  try {
    put = await putFile(upload.data.uploadUrl, file);
  } catch {
    return { ok: false, code: "UPLOAD_FAILED", stage: "uploading" };
  }
  if (put.status < 200 || put.status >= 300) {
    return { ok: false, code: uploadFailureCode(put), stage: "uploading" };
  }

  onStage?.("analyzing");

  let analysis: ActionResult<{ resumeId: string }>;
  try {
    analysis = await analyze({ ...details, resumeKey: upload.data.resumeKey, submissionKey });
  } catch {
    return { ok: false, code: "REQUEST_FAILED", stage: "analyzing" };
  }
  if (!analysis.ok) {
    return { ok: false, code: analysis.code, stage: "analyzing", ...(analysis.meta ? { meta: analysis.meta } : {}) };
  }

  return { ok: true, resumeId: analysis.data.resumeId };
}
