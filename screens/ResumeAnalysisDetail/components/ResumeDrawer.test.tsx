// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getResumeViewUrlAction } from "@/screens/ResumeAnalysisDetail/actions/getResumeViewUrlAction";
import ResumeDrawer from "./ResumeDrawer";

vi.mock("@/screens/ResumeAnalysisDetail/actions/getResumeViewUrlAction", () => ({
  getResumeViewUrlAction: vi.fn(),
}));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const SIGNED = "https://project.supabase.test/storage/v1/object/sign/files-bucket/cv/u/x.pdf?token=";

let signed = 0;

beforeAll(() => {
  // jsdom implements <dialog> without showModal.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  signed = 0;
  vi.mocked(getResumeViewUrlAction).mockImplementation(async () => {
    signed += 1;
    return { ok: true, data: { url: `${SIGNED}tok_${signed}`, expiresInSeconds: 600 } };
  });
});

afterEach(cleanup);

const mount = () => render(<ResumeDrawer resumeId={RESUME_ID} title="Backend Engineer · Northwind" />);

async function openDrawer() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /view cv/i }));
  });
}

describe("ResumeDrawer", () => {
  it("signs when it opens, not before, and shows the fresh URL in the frame", async () => {
    const { container } = mount();
    expect(getResumeViewUrlAction).not.toHaveBeenCalled();
    expect(container.querySelector("object")).toBeNull();

    await openDrawer();

    expect(getResumeViewUrlAction).toHaveBeenCalledWith({ resumeId: RESUME_ID });
    expect(container.querySelector("object")?.getAttribute("data")).toBe(`${SIGNED}tok_1#view=FitH`);
    expect(container.innerHTML).not.toContain("/object/public/");
  });

  it("signs again on every open: a page left open past the signature still works", async () => {
    const { container } = mount();
    await openDrawer();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
    });
    await openDrawer();

    expect(getResumeViewUrlAction).toHaveBeenCalledTimes(2);
    expect(container.querySelector("object")?.getAttribute("data")).toBe(`${SIGNED}tok_2#view=FitH`);
  });

  it("shows a retryable error when signing fails, and Try again signs anew", async () => {
    vi.mocked(getResumeViewUrlAction).mockResolvedValueOnce({ ok: false, code: "STORAGE_UNAVAILABLE" });
    const { container } = mount();
    await openDrawer();

    expect(screen.getByRole("alert").textContent).toMatch(/couldn't open the cv\. try again/i);
    expect(container.querySelector("object")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    });
    expect(getResumeViewUrlAction).toHaveBeenCalledTimes(2);
    // The failed call never signed; the retry is the first signature.
    expect(container.querySelector("object")?.getAttribute("data")).toContain("?token=tok_1");
  });

  it("treats a rejected action as a failed request, retryable too", async () => {
    vi.mocked(getResumeViewUrlAction).mockRejectedValueOnce(new Error("deployment changed"));
    mount();
    await openDrawer();

    expect(screen.getByRole("alert").textContent).toMatch(/didn't go through/);
  });

  it("opens a new tab on a fresh signature, through a window opened before the await", async () => {
    const replace = vi.fn();
    const close = vi.fn();
    const open = vi.fn(() => ({ location: { replace }, close }) as unknown as Window);
    vi.stubGlobal("open", open);
    mount();
    await openDrawer();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open in new tab/i }));
    });

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(getResumeViewUrlAction).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledWith(`${SIGNED}tok_2`);
    expect(close).not.toHaveBeenCalled();

    // When the signature fails, the blank window is closed again.
    vi.mocked(getResumeViewUrlAction).mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /open in new tab/i }));
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
