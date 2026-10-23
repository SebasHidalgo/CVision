// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AttemptNotScored from "./AttemptNotScored";

afterEach(cleanup);

const mount = (reason: "silent" | "lost" | "failed", startsLeft = 2) =>
  render(<AttemptNotScored interview={{ id: "int_1", role: "Backend Engineer" }} reason={reason} startsLeft={startsLeft} date="October 23, 2026" />);

describe("AttemptNotScored", () => {
  it("says a call the platform could not run cost nothing and no start, and sends the candidate back to the room", () => {
    mount("failed", 3);
    const text = document.body.textContent ?? "";
    expect(text).toContain("The interviewer couldn't join the call.");
    expect(text).toContain("Nothing was charged, and this didn't use one of your starts.");
    expect(text).toContain("not with your microphone");
    expect(text).not.toContain("That start counts");
    expect(text).toContain("you have 3 starts left");
    expect(screen.getByRole("link", { name: /back to the room/i })).toHaveProperty("href", expect.stringContaining("/interview/int_1"));
  });

  it("counts the start for a silent or a lost call, which were the candidate's connection", () => {
    mount("silent", 1);
    expect(document.body.textContent).toContain("That start counts, but the interview is still yours: you have 1 start left.");
    cleanup();
    mount("lost", 2);
    expect(document.body.textContent).toContain("That start counts, but the interview is still yours: you have 2 starts left.");
  });
});
