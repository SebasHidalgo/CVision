import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLERK_LOOKUP_BATCH, ClerkLookupError, type ClerkUserLookup } from "@/lib/clerk/users";
import type { AccountDeletion } from "@/lib/deletion";
import type { UserListing } from "@/lib/database/userById";
import { BLAST_RADIUS_MAX_COUNT, blastRadiusLimit, reconcileUsers, type ReconcileDependencies } from "./accountReconcile";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const OLD = new Date("2026-10-01T00:00:00Z");

const SUMMARY: AccountDeletion = {
  analyses: 2,
  leftoverObjects: 0,
  leftoverObjectsRemoved: true,
  objectsRemoved: 2,
  conversationsDeleted: 3,
  conversationsFailed: 0,
  subscriptionsCanceled: 0,
  subscriptionsFailed: 0,
  userRowRemoved: true,
};

const ids = (n: number, prefix = "user_") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, "0")}`);

/** A table of accounts and a Clerk that knows some of them; every call is a spy. */
function world(options: { local: string[]; atClerk: string[]; recent?: number }) {
  const rows: UserListing[] = [...options.local].sort().map((id) => ({ id, createdAt: OLD }));
  const atClerk = new Set(options.atClerk);
  const lookup: ClerkUserLookup = {
    listExisting: vi.fn(async (batch: string[]) => new Set(batch.filter((id) => atClerk.has(id)))),
    isGone: vi.fn(async (id: string) => !atClerk.has(id)),
  };
  const deps: ReconcileDependencies = {
    listUsers: vi.fn(async ({ afterId, take, createdBefore }: { createdBefore: Date; afterId: string | null; take: number }) => {
      expect(createdBefore.getTime()).toBe(NOW - 24 * 3_600_000);
      return rows.filter((row) => afterId === null || row.id > afterId).slice(0, take);
    }),
    countRecent: vi.fn(async () => options.recent ?? 0),
    lookup,
    deleteAccount: vi.fn(async () => SUMMARY),
    now: () => NOW,
  };
  return deps;
}

beforeEach(() => {
  for (const method of ["info", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

describe("reconcileUsers", () => {
  it("keeps an account Clerk still has", async () => {
    const deps = world({ local: ids(10), atClerk: ids(10) });
    const report = await reconcileUsers({ apply: true }, deps);
    expect(report).toMatchObject({ checked: 10, candidates: 0, outcome: "nothing", deleted: [] });
    expect(deps.lookup.isGone).not.toHaveBeenCalled();
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes an account Clerk no longer has, once, after confirming it by id, with an audit line", async () => {
    const local = ids(10);
    const deps = world({ local, atClerk: local.slice(1) });
    const report = await reconcileUsers({ apply: true }, deps);

    expect(report).toMatchObject({ checked: 10, candidates: 1, outcome: "done", deleted: [local[0]] });
    expect(deps.lookup.isGone).toHaveBeenCalledWith(local[0]);
    expect(deps.deleteAccount).toHaveBeenCalledTimes(1);
    expect(deps.deleteAccount).toHaveBeenCalledWith(local[0]);
    expect(console.info).toHaveBeenCalledWith(
      `[CVision][reconcile-users] deleted user=${local[0]} analyses=2 objects=2 conversations=3 conversationsFailed=0 subscriptionsCanceled=0 subscriptionsFailed=0 userRow=removed`,
    );
  });

  it("only reports in a dry run", async () => {
    const local = ids(10);
    const deps = world({ local, atClerk: local.slice(1) });
    const report = await reconcileUsers({ apply: false }, deps);
    expect(report).toMatchObject({ mode: "dry-run", outcome: "ready", gone: [{ id: local[0], createdAt: OLD }], deleted: [] });
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes nothing when Clerk fails at any lookup, the list or the confirmation", async () => {
    const local = ids(CLERK_LOOKUP_BATCH + 5);
    const listing = world({ local, atClerk: local.slice(1) });
    vi.mocked(listing.lookup.listExisting)
      .mockImplementationOnce(async (batch) => new Set(batch.slice(1)))
      .mockRejectedValueOnce(new ClerkLookupError("list: HTTP 503"));
    await expect(reconcileUsers({ apply: true }, listing)).rejects.toThrow(ClerkLookupError);
    expect(listing.lookup.isGone).not.toHaveBeenCalled();
    expect(listing.deleteAccount).not.toHaveBeenCalled();

    const confirming = world({ local, atClerk: local.slice(2) });
    vi.mocked(confirming.lookup.isGone).mockResolvedValueOnce(true).mockRejectedValueOnce(new ClerkLookupError("user: HTTP 401"));
    await expect(reconcileUsers({ apply: true }, confirming)).rejects.toThrow(ClerkLookupError);
    expect(confirming.deleteAccount).not.toHaveBeenCalled();
  });

  it("keeps an account the list missed but Clerk finds by id", async () => {
    const local = ids(10);
    const deps = world({ local, atClerk: local });
    vi.mocked(deps.lookup.listExisting).mockImplementationOnce(async (batch) => new Set(batch.slice(1)));
    const report = await reconcileUsers({ apply: true }, deps);
    expect(report).toMatchObject({ candidates: 1, listMismatches: 1, outcome: "nothing" });
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it.each([
    [CLERK_LOOKUP_BATCH, 1, 2],
    [CLERK_LOOKUP_BATCH + 1, 2, 2],
    [CLERK_LOOKUP_BATCH * 2, 2, 3],
    [CLERK_LOOKUP_BATCH - 1, 1, 1],
  ])("walks %i accounts in %i Clerk call(s) and %i page read(s), checking each once", async (count, clerkCalls, pages) => {
    const local = ids(count);
    const deps = world({ local, atClerk: local.slice(0, -1) });
    const report = await reconcileUsers({ apply: true }, deps);

    expect(deps.lookup.listExisting).toHaveBeenCalledTimes(clerkCalls);
    expect(deps.listUsers).toHaveBeenCalledTimes(pages);
    const asked = vi.mocked(deps.lookup.listExisting).mock.calls.flatMap(([batch]) => batch);
    expect(asked).toEqual(local);
    expect(report).toMatchObject({ checked: count, candidates: 1, deleted: [local[count - 1]] });
  });

  it("refuses, loudly and before any confirmation, a run over the blast-radius limit", async () => {
    const local = ids(50);
    const deps = world({ local, atClerk: local.slice(11) });
    const report = await reconcileUsers({ apply: true }, deps);

    expect(report).toMatchObject({ checked: 50, candidates: 11, limit: 10, limitSource: "default", outcome: "refused" });
    expect(deps.lookup.isGone).not.toHaveBeenCalled();
    expect(deps.deleteAccount).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/REFUSED: 11 of 50 accounts .* --max-delete 11/));
  });

  it("refuses the wrong instance's key, which makes every account look gone", async () => {
    const deps = world({ local: ids(3), atClerk: [] });
    expect(await reconcileUsers({ apply: true }, deps)).toMatchObject({ candidates: 3, limit: 0, outcome: "refused" });
    expect(deps.deleteAccount).not.toHaveBeenCalled();
  });

  it("goes as far as an operator's explicit ceiling, and no further", async () => {
    const local = ids(30);
    const allowed = world({ local, atClerk: local.slice(17) });
    expect(await reconcileUsers({ apply: true, maxDelete: 17 }, allowed)).toMatchObject({ limitSource: "operator", outcome: "done" });
    expect(allowed.deleteAccount).toHaveBeenCalledTimes(17);

    const short = world({ local, atClerk: local.slice(17) });
    expect(await reconcileUsers({ apply: true, maxDelete: 16 }, short)).toMatchObject({ outcome: "refused" });
    expect(short.deleteAccount).not.toHaveBeenCalled();
  });

  it("never looks up an account younger than a day, and counts it", async () => {
    const deps = world({ local: ids(10), atClerk: ids(10), recent: 4 });
    const report = await reconcileUsers({ apply: true }, deps);
    expect(report.skippedRecent).toBe(4);
    expect(deps.countRecent).toHaveBeenCalledWith(new Date(NOW - 24 * 3_600_000));
  });

  it("starts no deletion past the deadline and leaves the rest for the next run", async () => {
    const local = ids(20);
    const deps = world({ local, atClerk: local.slice(3) });
    let clock = NOW;
    deps.now = () => clock;
    vi.mocked(deps.deleteAccount).mockImplementation(async () => {
      clock += 30_000;
      return SUMMARY;
    });
    const report = await reconcileUsers({ apply: true, deadline: NOW + 45_000 }, deps);
    expect(report).toMatchObject({ outcome: "partial", deleted: local.slice(0, 2), deferred: [local[2]] });
  });

  it("stops at the first failed deletion and says which", async () => {
    const local = ids(20);
    const deps = world({ local, atClerk: local.slice(3) });
    vi.mocked(deps.deleteAccount).mockResolvedValueOnce(SUMMARY).mockRejectedValueOnce(new Error("db down"));
    const report = await reconcileUsers({ apply: true }, deps);
    expect(report).toMatchObject({ outcome: "partial", deleted: [local[0]], failed: local[1] });
    expect(deps.deleteAccount).toHaveBeenCalledTimes(2);
  });
});

describe("blastRadiusLimit", () => {
  it("is a fifth of the accounts checked, rounded down, at most 25", () => {
    expect(blastRadiusLimit(0)).toBe(0);
    expect(blastRadiusLimit(4)).toBe(0);
    expect(blastRadiusLimit(5)).toBe(1);
    expect(blastRadiusLimit(50)).toBe(10);
    expect(blastRadiusLimit(10_000)).toBe(BLAST_RADIUS_MAX_COUNT);
  });
});
