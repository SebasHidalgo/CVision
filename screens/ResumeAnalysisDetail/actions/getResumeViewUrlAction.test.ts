import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { fetchResumeKey } from "@/lib/database/resume";
import { StorageUnavailableError, UnauthorizedError } from "@/lib/error/errors";
import { createSignedReadUrl } from "@/lib/supabase/server";
import { getResumeViewUrlAction } from "./getResumeViewUrlAction";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/database/resume", () => ({ fetchResumeKey: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSignedReadUrl: vi.fn(), SIGNED_READ_TTL_SECONDS: 600 }));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const KEY = "cv/user_1/11111111-2222-4333-8444-555555555555.pdf";

let signed = 0;

beforeEach(() => {
  vi.clearAllMocks();
  signed = 0;
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(fetchResumeKey).mockResolvedValue(KEY);
  vi.mocked(createSignedReadUrl).mockImplementation(async (key) => {
    signed += 1;
    return `https://project.supabase.test/storage/v1/object/sign/files-bucket/${key}?token=tok_${signed}`;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getResumeViewUrlAction", () => {
  it("signs a fresh URL for the caller's own CV on every call", async () => {
    const first = await getResumeViewUrlAction({ resumeId: RESUME_ID });
    const second = await getResumeViewUrlAction({ resumeId: RESUME_ID });

    expect(first).toEqual({
      ok: true,
      data: { url: expect.stringContaining("?token=tok_1"), expiresInSeconds: 600 },
    });
    expect(second).toEqual({ ok: true, data: { url: expect.stringContaining("?token=tok_2"), expiresInSeconds: 600 } });
    expect(fetchResumeKey).toHaveBeenCalledWith(RESUME_ID);
    expect(createSignedReadUrl).toHaveBeenCalledTimes(2);
  });

  it("answers NOT_FOUND for a foreign or missing analysis without signing anything", async () => {
    vi.mocked(fetchResumeKey).mockResolvedValue(null);

    expect(await getResumeViewUrlAction({ resumeId: RESUME_ID })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(createSignedReadUrl).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND when the object behind the row is gone", async () => {
    vi.mocked(createSignedReadUrl).mockResolvedValue(null);

    expect(await getResumeViewUrlAction({ resumeId: RESUME_ID })).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("passes storage trouble through as its code, and refuses a signed-out caller or a bad id", async () => {
    vi.mocked(createSignedReadUrl).mockRejectedValue(new StorageUnavailableError());
    expect(await getResumeViewUrlAction({ resumeId: RESUME_ID })).toEqual({ ok: false, code: "STORAGE_UNAVAILABLE" });

    expect(await getResumeViewUrlAction({ resumeId: "not-a-uuid" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(fetchResumeKey).toHaveBeenCalledTimes(1);

    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect(await getResumeViewUrlAction({ resumeId: RESUME_ID })).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });
});
