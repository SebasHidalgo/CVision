import { describe, expect, it, vi } from "vitest";
import { putResumeFile, runResumeUpload, type UploadStage } from "./upload";

const KEY = "cv/user_1/11111111-2222-4333-8444-555555555555.pdf";
const UPLOAD_URL = `https://project.supabase.test/storage/v1/object/upload/sign/files-bucket/${KEY}?token=up_tok`;

const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "cv.pdf", { type: "application/pdf" });
const details = { companyName: "Northwind", jobTitle: "Frontend Engineer", jobDescription: "React." };

type Deps = Parameters<typeof runResumeUpload>[0];

function deps(overrides: Partial<Deps> = {}) {
  return {
    file,
    details,
    createUpload: vi.fn(async () => ({ ok: true as const, data: { resumeKey: KEY, uploadUrl: UPLOAD_URL } })),
    putFile: vi.fn(async () => ({ status: 200, code: null })),
    analyze: vi.fn(async () => ({ ok: true as const, data: { resumeId: "resume_1" } })),
    ...overrides,
  };
}

describe("runResumeUpload", () => {
  it("asks for a place, PUTs the file there, then analyzes the key, reporting both stages", async () => {
    const stages: UploadStage[] = [];
    const d = deps({ onStage: (stage) => stages.push(stage) });

    const result = await runResumeUpload(d);

    expect(result).toEqual({ ok: true, resumeId: "resume_1" });
    expect(d.putFile).toHaveBeenCalledWith(UPLOAD_URL, file);
    expect(d.analyze).toHaveBeenCalledWith({ ...details, resumeKey: KEY });
    expect(stages).toEqual(["uploading", "analyzing"]);
  });

  it("never calls the analysis when the PUT fails, and names the failure by the platform's code", async () => {
    // Storage answers a refused upload with HTTP 400 and the code in the body.
    for (const [outcome, code] of [
      [{ status: 500, code: null }, "UPLOAD_FAILED"],
      [{ status: 400, code: "413" }, "FILE_TOO_LARGE"],
      [{ status: 400, code: "415" }, "NOT_A_PDF"],
      [{ status: 413, code: null }, "FILE_TOO_LARGE"],
      [{ status: 400, code: "409" }, "UPLOAD_FAILED"],
    ] as const) {
      const d = deps({ putFile: vi.fn(async () => outcome) });

      expect(await runResumeUpload(d)).toEqual({ ok: false, code, stage: "uploading" });
      expect(d.analyze).not.toHaveBeenCalled();
    }

    const thrown = deps({
      putFile: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    expect(await runResumeUpload(thrown)).toEqual({ ok: false, code: "UPLOAD_FAILED", stage: "uploading" });
    expect(thrown.analyze).not.toHaveBeenCalled();
  });

  it("reports the analysis's own code when it fails after the upload", async () => {
    const d = deps({ analyze: vi.fn(async () => ({ ok: false as const, code: "PDF_NO_TEXT" as const })) });

    expect(await runResumeUpload(d)).toEqual({ ok: false, code: "PDF_NO_TEXT", stage: "analyzing" });
    expect(d.putFile).toHaveBeenCalledTimes(1);
  });

  it("stops before the PUT when no place could be made, and treats a thrown action as REQUEST_FAILED", async () => {
    const refused = deps({ createUpload: vi.fn(async () => ({ ok: false as const, code: "STORAGE_UNAVAILABLE" as const })) });
    expect(await runResumeUpload(refused)).toEqual({ ok: false, code: "STORAGE_UNAVAILABLE", stage: "uploading" });
    expect(refused.putFile).not.toHaveBeenCalled();

    const dropped = deps({
      analyze: vi.fn(async () => {
        throw new Error("deployment changed");
      }),
    });
    expect(await runResumeUpload(dropped)).toEqual({ ok: false, code: "REQUEST_FAILED", stage: "analyzing" });
  });
});

describe("putResumeFile", () => {
  it("PUTs the file with its type and nothing else: no key, no authorization", async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return new Response(null, { status: 200 });
      }),
    );

    expect(await putResumeFile(UPLOAD_URL, file)).toEqual({ status: 200, code: null });
    const [url, init] = calls[0];
    expect(url).toBe(UPLOAD_URL);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(file);
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/pdf");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("apikey")).toBeNull();
  });

  it("reads the platform's code out of a refused upload, and tolerates a body that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" },
          { status: 400 },
        ),
      ),
    );
    expect(await putResumeFile(UPLOAD_URL, file)).toEqual({ status: 400, code: "413" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>gateway</html>", { status: 502 })));
    expect(await putResumeFile(UPLOAD_URL, file)).toEqual({ status: 502, code: null });
  });
});
