import { describe, expect, it } from "vitest";
import { classifyObjects, missingObjects, ORPHAN_GRACE_HOURS } from "./gcClassify";

const NOW = new Date("2026-10-13T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);
const USER = "user_33lmzGC7RVwHdO7fMab9Qd6Ing8";
const key = (name: string) => `cv/${USER}/${name}`;

const object = (k: string, createdAt: Date | null, size = 1024) => ({ key: k, size, createdAt });

describe("classifyObjects", () => {
  const referenced = new Set([key("aaaaaaaa-0000-4000-8000-000000000001.pdf")]);

  it("keeps a referenced object whatever its age", () => {
    const [kept] = classifyObjects([object(key("aaaaaaaa-0000-4000-8000-000000000001.pdf"), hoursAgo(1000))], referenced, NOW);
    expect(kept.verdict).toEqual({ kind: "keep", why: "referenced" });
  });

  it("keeps an unreferenced cv/ object inside the grace, and orphans it once past it", () => {
    const young = object(key("bbbbbbbb-0000-4000-8000-000000000002.pdf"), hoursAgo(ORPHAN_GRACE_HOURS - 1));
    const old = object(key("cccccccc-0000-4000-8000-000000000003.pdf"), hoursAgo(ORPHAN_GRACE_HOURS + 1));

    const [a, b] = classifyObjects([young, old], referenced, NOW);
    expect(a.verdict).toEqual({ kind: "keep", why: "recent" });
    expect(b.verdict).toEqual({ kind: "orphan", why: "no-row" });
  });

  it("orphans anything outside cv/, however recent: nothing of ours writes there", () => {
    const [recording, loose] = classifyObjects(
      [
        object("interview-2747ce2a-fac7-4979-bd5b-427750732d6a-1788901265089.webm", hoursAgo(1), 6_881_093),
        object("1772964781998-Resume.pdf", hoursAgo(0.1)),
      ],
      referenced,
      NOW,
    );
    expect(recording.verdict).toEqual({ kind: "orphan", why: "outside-cv" });
    expect(loose.verdict).toEqual({ kind: "orphan", why: "outside-cv" });
  });

  it("keeps a cv/ object whose age the listing did not report", () => {
    const [kept] = classifyObjects([object(key("dddddddd-0000-4000-8000-000000000004.pdf"), null)], referenced, NOW);
    expect(kept.verdict).toEqual({ kind: "keep", why: "unknown-age" });
  });
});

describe("missingObjects", () => {
  it("names referenced keys with no object behind them", () => {
    const present = [object(key("aaaaaaaa-0000-4000-8000-000000000001.pdf"), hoursAgo(1))];
    const referenced = new Set([key("aaaaaaaa-0000-4000-8000-000000000001.pdf"), key("eeeeeeee-0000-4000-8000-000000000005.pdf")]);

    expect(missingObjects(present, referenced)).toEqual([key("eeeeeeee-0000-4000-8000-000000000005.pdf")]);
  });
});
