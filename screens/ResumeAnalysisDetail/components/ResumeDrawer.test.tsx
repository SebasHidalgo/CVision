// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import ResumeDrawer from "./ResumeDrawer";

const SIGNED = "https://project.supabase.test/storage/v1/object/sign/files-bucket/cv/u/x.pdf?token=tok_abc";

beforeAll(() => {
  // jsdom implements <dialog> without showModal.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

afterEach(cleanup);

describe("ResumeDrawer", () => {
  it("renders the signed URL it is given, in the frame and both links, and nothing else", () => {
    const { container } = render(<ResumeDrawer resumeUrl={SIGNED} title="Backend Engineer · Northwind" />);

    fireEvent.click(screen.getByRole("button", { name: /view cv/i }));

    const frame = container.querySelector("object");
    expect(frame?.getAttribute("data")).toBe(`${SIGNED}#view=FitH`);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([SIGNED, SIGNED]);
    expect(container.innerHTML).not.toContain("/object/public/");
  });

  it("says the CV is unavailable, with no frame and no link, when there is no URL to show", () => {
    const { container } = render(<ResumeDrawer resumeUrl={null} title="Backend Engineer · Northwind" />);

    const button = screen.getByRole("button", { name: /cv unavailable/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector("object")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});
