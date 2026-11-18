// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { deleteOneAnalysisAction } from "@/screens/ResumeAnalyses/actions/deleteOneAnalysisAction";
import { DeleteUnreadable } from "./DeleteUnreadable";

vi.mock("next/font/google", () => ({ Host_Grotesk: () => ({ variable: "font-text" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/screens/ResumeAnalyses/actions/deleteOneAnalysisAction", () => ({ deleteOneAnalysisAction: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteOneAnalysisAction).mockResolvedValue({ ok: true, data: { deleted: true } });
});

afterEach(cleanup);

const mount = () =>
  render(
    <>
      <h1 id="analyses-title" tabIndex={-1}>
        Analyses
      </h1>
      <DeleteUnreadable resumeId="a1" jobTitle="Backend Engineer" companyName="Contoso" date="Oct 9, 2026" returnFocusTo="analyses-title" />
    </>,
  );

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("DeleteUnreadable", () => {
  it("deletes the unreadable analysis after confirming and hands focus to the page heading", async () => {
    mount();
    await click(screen.getByRole("button", { name: "Delete Backend Engineer at Contoso, Oct 9, 2026" }));
    expect(deleteOneAnalysisAction).not.toHaveBeenCalled();
    await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete analysis" }));

    expect(deleteOneAnalysisAction).toHaveBeenCalledWith({ resumeId: "a1" });
    expect(toast.success).toHaveBeenCalledWith("Deleted Backend Engineer at Contoso.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement?.id).toBe("analyses-title");
  });

  it("shows a refusal as an error toast and keeps the row", async () => {
    vi.mocked(deleteOneAnalysisAction).mockResolvedValue({ ok: false, code: "ANALYSIS_BUSY" });
    mount();
    await click(screen.getByRole("button", { name: /Delete Backend Engineer/ }));
    await click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete analysis" }));
    expect(toast.error).toHaveBeenCalledWith("An interview for this analysis is in progress. Try again when it ends.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
