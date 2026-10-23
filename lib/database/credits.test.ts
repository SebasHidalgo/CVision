import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { creditBalanceIn, grantInterviewCredits, interviewCreditBalance } from "./credits";

vi.mock("@/lib/prisma", () => ({
  default: { usageEvent: { create: vi.fn(), groupBy: vi.fn() } },
}));

const NOW = new Date("2026-10-16T12:00:00Z");

/** What the one credit query answers: units summed per kind (a consumption is one unit). */
const ledger = (granted: number, used = 0, revoked = 0) =>
  [
    { kind: "INTERVIEW_CREDIT_GRANT", _sum: { units: granted } },
    { kind: "INTERVIEW_CREDIT", _sum: { units: used } },
    { kind: "INTERVIEW_CREDIT_REVOKE", _sum: { units: revoked } },
  ] as never;

const known = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: "test" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.usageEvent.groupBy).mockResolvedValue([] as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("grantInterviewCredits", () => {
  it("grants a pack once: the transaction id is the grant's key, and a replay grants nothing", async () => {
    vi.mocked(prisma.usageEvent.create).mockResolvedValueOnce({} as never);
    expect(await grantInterviewCredits("user_1", { units: 4, transactionId: "txn_1", now: NOW })).toEqual({ granted: true });
    expect(prisma.usageEvent.create).toHaveBeenCalledWith({
      data: { userId: "user_1", kind: "INTERVIEW_CREDIT_GRANT", refId: "txn_1", units: 4, createdAt: NOW },
    });

    vi.mocked(prisma.usageEvent.create).mockRejectedValueOnce(known("P2002"));
    expect(await grantInterviewCredits("user_1", { units: 4, transactionId: "txn_1", now: NOW })).toEqual({ granted: false, reason: "already" });
  });

  it("says so when the user's row is gone (the account was deleted under the event), and still throws on anything else", async () => {
    vi.mocked(prisma.usageEvent.create).mockRejectedValueOnce(known("P2003"));
    expect(await grantInterviewCredits("user_gone", { units: 4, transactionId: "txn_2", now: NOW })).toEqual({ granted: false, reason: "no-user" });

    vi.mocked(prisma.usageEvent.create).mockRejectedValueOnce(new Error("db down"));
    await expect(grantInterviewCredits("user_1", { units: 4, transactionId: "txn_3", now: NOW })).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});

describe("the balance", () => {
  it("is grants minus revokes minus non-refunded consumption, never below zero, read in one query", async () => {
    vi.mocked(prisma.usageEvent.groupBy).mockResolvedValueOnce(ledger(10, 4, 3));
    expect(await interviewCreditBalance("user_1")).toBe(3);
    expect(prisma.usageEvent.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.usageEvent.groupBy).toHaveBeenCalledWith({
      by: ["kind"],
      where: {
        userId: "user_1",
        OR: [{ kind: { in: ["INTERVIEW_CREDIT_GRANT", "INTERVIEW_CREDIT_REVOKE"] } }, { kind: "INTERVIEW_CREDIT", refundedAt: null }],
      },
      _sum: { units: true },
    });

    vi.mocked(prisma.usageEvent.groupBy).mockResolvedValueOnce(ledger(5, 2, 5));
    expect(await interviewCreditBalance("user_1")).toBe(0);

    // A kind with no rows is simply absent from the answer; a grant of five and one of four add up.
    vi.mocked(prisma.usageEvent.groupBy).mockResolvedValueOnce([{ kind: "INTERVIEW_CREDIT_GRANT", _sum: { units: 9 } }] as never);
    expect(await interviewCreditBalance("user_1")).toBe(9);
  });

  it("runs on whatever client it is given, so a reservation reads it inside its own transaction", async () => {
    const tx = { usageEvent: { groupBy: vi.fn(async () => ledger(2, 1)) } };
    expect(await creditBalanceIn(tx as never, "user_1")).toBe(1);
    expect(prisma.usageEvent.groupBy).not.toHaveBeenCalled();
  });
});
