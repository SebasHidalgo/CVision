import type { ErrorCode } from "@/lib/error/errors";
import type { ResumeDetails } from "@/lib/schemas/resumeSchema";
import type { ActionResult } from "@/types/action";
import type { ResumeUpload } from "../actions/createResumeUploadAction";

export type UploadStage = "uploading" | "analyzing";

export type UploadFlowResult =
  | { ok: true; resumeId: string }
  | { ok: false; code: ErrorCode; stage: UploadStage };

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
  /** Server action: a key and a signed URL. */
  createUpload: () => Promise<ActionResult<ResumeUpload>>;
  /** Server action: analyze the object under the key. */
  analyze: (input: ResumeDetails & { resumeKey: string }) => Promise<ActionResult<{ resumeId: string }>>;
  /** The PUT itself; `putResumeFile` by default, a stub in tests. */
  putFile?: (url: string, file: File) => Promise<PutOutcome>;
  onStage?: (stage: UploadStage) => void;
};

/**
 * The browser's PUT to the signed URL: the file, its type, nothing else. No
 * Supabase key travels; the token in the URL is the authorization. A
 * failure here is reported by its code and never reaches the analysis.
 */
export async function putResumeFile(url: string, file: File): Promise<PutOutcome> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/pdf" },
    body: file,
  });
  if (response.ok) return { status: response.status, code: null };
  const body = (await response.json().catch(() => null)) as { statusCode?: unknown } | null;
  return {
    status: response.status,
    code: typeof body?.statusCode === "string" ? body.statusCode : null,
  };
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
  if (!upload.ok) return { ok: false, code: upload.code, stage: "uploading" };

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
    analysis = await analyze({ ...details, resumeKey: upload.data.resumeKey });
  } catch {
    return { ok: false, code: "REQUEST_FAILED", stage: "analyzing" };
  }
  if (!analysis.ok) return { ok: false, code: analysis.code, stage: "analyzing" };

  return { ok: true, resumeId: analysis.data.resumeId };
}
