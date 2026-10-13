import { describe, expect, it } from "vitest";
import {
  POLL_FAST_MS,
  POLL_FAST_UNTIL_MS,
  POLL_MEDIUM_MS,
  POLL_MEDIUM_UNTIL_MS,
  POLL_SLOW_MS,
  pollDelayMs,
  pollsDuring,
} from "./pollDelay";

describe("pollDelayMs", () => {
  it("polls every 3 s for the first 30 s, every 5 s until 2 min, then every 10 s", () => {
    expect(pollDelayMs(0)).toBe(POLL_FAST_MS);
    expect(pollDelayMs(POLL_FAST_UNTIL_MS - 1)).toBe(POLL_FAST_MS);
    expect(pollDelayMs(POLL_FAST_UNTIL_MS)).toBe(POLL_MEDIUM_MS);
    expect(pollDelayMs(POLL_MEDIUM_UNTIL_MS - 1)).toBe(POLL_MEDIUM_MS);
    expect(pollDelayMs(POLL_MEDIUM_UNTIL_MS)).toBe(POLL_SLOW_MS);
    expect(pollDelayMs(60 * 60_000)).toBe(POLL_SLOW_MS);
  });
});

describe("pollsDuring", () => {
  it("costs fewer, cheaper requests than a render every three seconds did", () => {
    // The owner's live run: about a minute until the webhook. 20 page renders before.
    expect(pollsDuring(60_000)).toBe(16);
    // A four-minute wait: 80 renders before.
    expect(pollsDuring(240_000)).toBe(40);
    // A twelve-minute interview whose webhook never came, up to the reconcile window.
    expect(pollsDuring(14 * 60_000)).toBe(100);
  });
});
