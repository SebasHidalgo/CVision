import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertRateLimit } from "@/lib/database/rateLimit";
import { usageSummary, type UsageSummary } from "@/lib/database/usage";
import { ensureUser } from "@/lib/database/user";
import { RateLimitedError, StorageUnavailableError, UnauthorizedError } from "@/lib/error/errors";
import { isResumeKeyOf } from "@/lib/supabase/resumeKey";
import { createSignedUploadUrl } from "@/lib/supabase/server";
import { createResumeUploadAction } from "./createResumeUploadAction";

vi.mock("@/lib/database/user", () => ({ ensureUser: vi.fn() }));
vi.mock("@/lib/database/rateLimit", () => ({ assertRateLimit: vi.fn(async () => {}) }));
vi.mock("@/lib/database/usage", () => ({ usageSummary: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSignedUploadUrl: vi.fn() }));

const summary = (overrides: Partial<UsageSummary> = {}): UsageSummary => ({
  plan: "FREE",
  source: "free",
  analyses: { used: 1, limit: 3, left: 2, announce: true },
  interviews: { used: 0, limit: 0, left: 0 },
  credits: { balance: 0, usable: false },
  trial: { available: true, used: false },
  period: { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") },
  resetsAt: new Date("2026-11-01T00:00:00Z"),
  subscription: null,
  everSubscribed: false,
  ...overrides,
});

beforeEach(() => {
  // clearAllMocks drops call history, not implementations set by a test.
  vi.clearAllMocks();
  vi.mocked(ensureUser).mockResolvedValue("user_1");
  vi.mocked(assertRateLimit).mockResolvedValue(undefined);
  vi.mocked(usageSummary).mockResolvedValue(summary());
  vi.mocked(createSignedUploadUrl).mockImplementation(
    async (key) => `https://project.supabase.test/storage/v1/object/upload/sign/files-bucket/${key}?token=up_tok`,
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createResumeUploadAction", () => {
  it("makes sure the account's row exists, applies the hourly limit, checks the quota, then mints a key under the caller's prefix", async () => {
    const result = await createResumeUploadAction();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ensureUser).toHaveBeenCalledTimes(1);
    expect(assertRateLimit).toHaveBeenCalledWith("user_1", "uploadUrl");
    expect(usageSummary).toHaveBeenCalledWith("user_1");
    expect(isResumeKeyOf(result.data.resumeKey, "user_1")).toBe(true);
    expect(createSignedUploadUrl).toHaveBeenCalledWith(result.data.resumeKey);
    expect(result.data.uploadUrl).toContain(`/object/upload/sign/files-bucket/${result.data.resumeKey}?token=`);
  });

  it("refuses an upload URL at zero quota, with the reset date, without reserving anything", async () => {
    vi.mocked(usageSummary).mockResolvedValue(summary({ analyses: { used: 3, limit: 3, left: 0, announce: true } }));

    expect(await createResumeUploadAction()).toEqual({
      ok: false,
      code: "ANALYSIS_QUOTA_EXCEEDED",
      meta: { plan: "FREE", resetsAt: "2026-11-01T00:00:00.000Z" },
    });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("answers RATE_LIMITED with the wait before touching the quota or storage", async () => {
    vi.mocked(assertRateLimit).mockRejectedValue(new RateLimitedError(120));

    expect(await createResumeUploadAction()).toEqual({ ok: false, code: "RATE_LIMITED", meta: { retryAfter: 120 } });
    expect(usageSummary).not.toHaveBeenCalled();
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
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
