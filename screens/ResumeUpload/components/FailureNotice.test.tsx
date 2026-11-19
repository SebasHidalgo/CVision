// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import FailureNotice from "./FailureNotice";

afterEach(cleanup);

const MESSAGE = "The request didn't go through. Check your connection and try again.";

/** The text of the elements an aria-labelledby / aria-describedby list names, in order. */
const textOf = (ids: string | null) =>
  (ids ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("FailureNotice", () => {
  it("takes focus, and focus alone announces it: named by where the run stopped, described by why and what was kept", () => {
    const { container } = render(<FailureNotice stage="analyzing" message={MESSAGE} />);
    const notice = container.querySelector("[data-failure-notice]") as HTMLElement;

    expect(document.activeElement).toBe(notice);
    expect(notice.getAttribute("role")).toBe("group");
    expect(textOf(notice.getAttribute("aria-labelledby"))).toBe("Stopped at the analysis");
    expect(textOf(notice.getAttribute("aria-describedby"))).toBe(`${MESSAGE} Everything you entered is still here, your file included.`);
  });

  it("is not a live region, nor inside one: an alert that also takes focus is read twice", () => {
    const { container } = render(
      <div>
        <FailureNotice stage="uploading" message={MESSAGE} />
      </div>,
    );
    const notice = container.querySelector("[data-failure-notice]") as HTMLElement;

    for (let node: HTMLElement | null = notice; node; node = node.parentElement) {
      expect(["alert", "status", "log"]).not.toContain(node.getAttribute("role"));
      expect(node.hasAttribute("aria-live")).toBe(false);
    }
    expect(notice.querySelector("[role=alert], [role=status], [aria-live]")).toBeNull();
  });
});
