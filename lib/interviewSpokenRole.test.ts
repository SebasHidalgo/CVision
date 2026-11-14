import { beforeEach, describe, expect, it, vi } from "vitest";
import { translateSpokenTitle } from "@/lib/ai/spokenRoleTitle";
import { claimTranslation, completeTranslation, failTranslation } from "@/lib/database/translation";
import { spokenRoleTitle } from "./interviewSpokenRole";

vi.mock("@/lib/database/translation", () => ({ claimTranslation: vi.fn(), completeTranslation: vi.fn(async () => true), failTranslation: vi.fn(async () => {}) }));
vi.mock("@/lib/ai/spokenRoleTitle", async (original) => ({ ...(await original<typeof import("@/lib/ai/spokenRoleTitle")>()), translateSpokenTitle: vi.fn() }));

const CLAIMED_AT = new Date("2026-11-14T10:00:00Z");
const row = (over: object = {}) => ({ id: "t1", claimedAt: CLAIMED_AT, payload: null, ...over }) as never;
const input = { userId: "u1", analysisId: "a1", title: "Desarrollador/a Jr.", company: "Northwind", from: "es" as const, to: "en" as const };

describe("spokenRoleTitle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when the interview speaks the posting's language", async () => {
    expect(await spokenRoleTitle({ ...input, to: "es" })).toBeNull();
    expect(claimTranslation).not.toHaveBeenCalled();
  });

  it("translates the posting's spoken form once and stores it beside the analysis", async () => {
    vi.mocked(claimTranslation).mockResolvedValueOnce({ kind: "claimed", row: row() });
    vi.mocked(translateSpokenTitle).mockResolvedValueOnce({ text: "Junior Developer", checks: [], attempts: 1, model: "m", modelVersion: "v" });
    expect(await spokenRoleTitle(input)).toBe("Junior Developer");
    // The seniority rule and one gender form come first.
    expect(vi.mocked(translateSpokenTitle).mock.calls[0][0]).toMatchObject({ title: "Desarrollador Junior", from: "es", to: "en" });
    expect(vi.mocked(claimTranslation).mock.calls[0].slice(0, 3)).toEqual(["u1", { analysisId: "a1" }, "title-en"]);
    expect(completeTranslation).toHaveBeenCalledWith("t1", CLAIMED_AT, expect.objectContaining({ payload: { text: "Junior Developer" } }));
  });

  it("reuses the stored title without a call", async () => {
    vi.mocked(claimTranslation).mockResolvedValueOnce({ kind: "ready", row: row({ payload: { text: "Junior Developer" } }) });
    expect(await spokenRoleTitle(input)).toBe("Junior Developer");
    expect(translateSpokenTitle).not.toHaveBeenCalled();
  });

  it("keeps the posting's title when the claim is busy, the checks fail, or the model is down", async () => {
    vi.mocked(claimTranslation).mockResolvedValueOnce({ kind: "busy" });
    expect(await spokenRoleTitle(input)).toBeNull();

    vi.mocked(claimTranslation).mockResolvedValueOnce({ kind: "claimed", row: row() });
    vi.mocked(translateSpokenTitle).mockResolvedValueOnce({ text: null, checks: ["name"], attempts: 2, model: "m", modelVersion: "v" });
    expect(await spokenRoleTitle(input)).toBeNull();
    expect(failTranslation).toHaveBeenCalledTimes(1);

    vi.mocked(claimTranslation).mockResolvedValueOnce({ kind: "claimed", row: row() });
    vi.mocked(translateSpokenTitle).mockRejectedValueOnce(Object.assign(new Error("down"), { code: "AI_UNAVAILABLE" }));
    expect(await spokenRoleTitle(input)).toBeNull();
    expect(failTranslation).toHaveBeenCalledTimes(2);

    vi.mocked(claimTranslation).mockRejectedValueOnce(new Error("db"));
    expect(await spokenRoleTitle(input)).toBeNull();
  });
});
