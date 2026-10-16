import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureUser } from "@/lib/database/user";
import { StorageUnavailableError, UnauthorizedError } from "@/lib/error/errors";
import { isResumeKeyOf } from "@/lib/supabase/resumeKey";
import { createSignedUploadUrl } from "@/lib/supabase/server";
import { createResumeUploadAction } from "./createResumeUploadAction";

vi.mock("@/lib/database/user", () => ({ ensureUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSignedUploadUrl: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureUser).mockResolvedValue("user_1");
  vi.mocked(createSignedUploadUrl).mockImplementation(
    async (key) => `https://project.supabase.test/storage/v1/object/upload/sign/files-bucket/${key}?token=up_tok`,
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createResumeUploadAction", () => {
  it("makes sure the account's row exists, then mints a key under the caller's prefix and a signed URL for exactly that key", async () => {
    const result = await createResumeUploadAction();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ensureUser).toHaveBeenCalledTimes(1);
    expect(isResumeKeyOf(result.data.resumeKey, "user_1")).toBe(true);
    expect(createSignedUploadUrl).toHaveBeenCalledWith(result.data.resumeKey);
    expect(result.data.uploadUrl).toContain(`/object/upload/sign/files-bucket/${result.data.resumeKey}?token=`);
  });

  it("answers UNAUTHORIZED without touching storage when there is no session", async () => {
    vi.mocked(ensureUser).mockRejectedValue(new UnauthorizedError());

    expect(await createResumeUploadAction()).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("passes storage trouble through as its code", async () => {
    vi.mocked(createSignedUploadUrl).mockRejectedValue(new StorageUnavailableError());

    expect(await createResumeUploadAction()).toEqual({ ok: false, code: "STORAGE_UNAVAILABLE" });
  });
});
