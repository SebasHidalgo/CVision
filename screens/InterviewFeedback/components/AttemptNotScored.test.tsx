// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Namespace } from "@/lib/i18n/config";
import AttemptNotScored from "./AttemptNotScored";

// A server component: its t comes from the request, here the English resources.
vi.mock("@/lib/i18n/server", async () => {
  const { tFor } = await import("@/lib/i18n/testing");
  return { getT: async (ns: Namespace) => tFor(ns, "en"), getLocale: async () => "en" };
});

afterEach(cleanup);

const mount = async (reason: "silent" | "lost" | "failed", startsLeft = 2) =>
  render(await AttemptNotScored({ interview: { id: "int_1", role: "Backend Engineer" }, reason, startsLeft, date: "October 23, 2026" }));

describe("AttemptNotScored", () => {
  it("says a call the platform could not run cost nothing and no start, and sends the candidate back to the room", async () => {
    await mount("failed", 3);
    const text = document.body.textContent ?? "";
    expect(text).toContain("The interviewer couldn't join the call.");
    expect(text).toContain("Nothing was charged, and this didn't use one of your starts.");
    expect(text).toContain("not with your microphone");
    expect(text).not.toContain("That start counts");
    expect(text).toContain("you have 3 starts left");
    expect(screen.getByRole("link", { name: /back to the room/i })).toHaveProperty("href", expect.stringContaining("/interview/int_1"));
  });

  it("counts the start for a silent or a lost call, which were the candidate's connection", async () => {
    await mount("silent", 1);
    expect(document.body.textContent).toContain("That start counts, but the interview is still yours: you have 1 start left.");
    cleanup();
    await mount("lost", 2);
    expect(document.body.textContent).toContain("That start counts, but the interview is still yours: you have 2 starts left.");
  });
});
