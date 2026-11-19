import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountEmailAddresses } from "@/lib/auth";
import { MIN_PEPPER_CHARS, normalizeEmail, trialClaimHash } from "./trialClaim";
import { forgetTrialIdentities, resolveTrialIdentity, trialIdentityFor } from "./trialIdentity";

vi.mock("@/lib/auth", () => ({ accountEmailAddresses: vi.fn() }));

const PEPPER = "k".repeat(MIN_PEPPER_CHARS);
const ENV = { TRIAL_CLAIM_PEPPER: PEPPER };
const verified = (emailAddress: string) => ({ emailAddress, verification: { status: "verified" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
  for (const method of ["error", "warn"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveTrialIdentity", () => {
  it("hashes every verified email of the account, never an unverified one", async () => {
    vi.mocked(accountEmailAddresses).mockResolvedValue([verified("ana@example.com"), { emailAddress: "other@example.com", verification: { status: "unverified" } }, verified("ana.b@gmail.com")]);

    expect(await resolveTrialIdentity("user_1", ENV)).toEqual({
      kind: "emails",
      hashes: [trialClaimHash("ana@example.com", PEPPER), trialClaimHash(normalizeEmail("ana.b@gmail.com")!, PEPPER)].sort(),
    });
    expect(accountEmailAddresses).toHaveBeenCalledWith("user_1");
  });

  it("without the pepper fails closed before asking Clerk, with one loud line per ten minutes", async () => {
    // Later than any earlier test's line, so the window starts clean.
    vi.setSystemTime(new Date("2026-11-20T00:00:00Z"));
    expect(await resolveTrialIdentity("user_1", {})).toEqual({ kind: "unavailable", cause: "no-pepper" });
    expect(await resolveTrialIdentity("user_2", { TRIAL_CLAIM_PEPPER: "short" })).toEqual({ kind: "unavailable", cause: "no-pepper" });
    expect(accountEmailAddresses).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("TRIAL_CLAIM_PEPPER IS MISSING"));

    vi.setSystemTime(new Date("2026-11-20T00:10:00Z"));
    await resolveTrialIdentity("user_3", {});
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Clerk cannot answer, naming the user, never throwing", async () => {
    vi.mocked(accountEmailAddresses).mockRejectedValue(Object.assign(new Error("boom"), { status: 503 }));

    expect(await resolveTrialIdentity("user_1", ENV)).toEqual({ kind: "unavailable", cause: "lookup-failed" });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/user=user_1 status=503/));
  });

  it("fails closed when Clerk never answers, after 5 seconds", async () => {
    vi.mocked(accountEmailAddresses).mockReturnValue(new Promise(() => {}));

    const identity = resolveTrialIdentity("user_1", ENV);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await identity).toEqual({ kind: "unavailable", cause: "lookup-failed" });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/user=user_1 status=none \(TimeoutError\)/));
  });

  it("fails closed with no verified email, with a warning", async () => {
    vi.mocked(accountEmailAddresses).mockResolvedValue([{ emailAddress: "ana@example.com", verification: { status: "unverified" } }]);

    expect(await resolveTrialIdentity("user_1", ENV)).toEqual({ kind: "unavailable", cause: "no-verified-email" });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("no verified email: user=user_1"));
  });
});

describe("trialIdentityFor", () => {
  beforeEach(() => {
    forgetTrialIdentities();
    vi.stubEnv("TRIAL_CLAIM_PEPPER", PEPPER);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets pages reuse an account's hashes for five minutes, while the reservation always asks Clerk", async () => {
    vi.mocked(accountEmailAddresses).mockResolvedValue([verified("ana@example.com")]);

    const first = await trialIdentityFor("user_1");
    expect(await trialIdentityFor("user_1")).toEqual(first);
    expect(accountEmailAddresses).toHaveBeenCalledTimes(1);

    await trialIdentityFor("user_1", { fresh: true });
    expect(accountEmailAddresses).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5 * 60_000 + 1);
    await trialIdentityFor("user_1");
    expect(accountEmailAddresses).toHaveBeenCalledTimes(3);
  });

  it("keeps a failed lookup only thirty seconds, and never one account's hashes for another", async () => {
    vi.mocked(accountEmailAddresses).mockRejectedValueOnce(new Error("down")).mockResolvedValue([verified("ana@example.com")]);

    expect(await trialIdentityFor("user_1")).toEqual({ kind: "unavailable", cause: "lookup-failed" });
    expect(await trialIdentityFor("user_1")).toEqual({ kind: "unavailable", cause: "lookup-failed" });
    vi.advanceTimersByTime(30_001);
    expect((await trialIdentityFor("user_1")).kind).toBe("emails");

    vi.mocked(accountEmailAddresses).mockResolvedValue([verified("bo@example.com")]);
    expect(await trialIdentityFor("user_2")).not.toEqual(await trialIdentityFor("user_1"));
  });
});
