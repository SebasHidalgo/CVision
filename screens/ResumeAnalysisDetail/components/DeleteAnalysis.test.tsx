// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { deleteAnalysisAction } from "@/screens/ResumeAnalysisDetail/actions/deleteAnalysisAction";
import DeleteAnalysis from "./DeleteAnalysis";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/screens/ResumeAnalysisDetail/actions/deleteAnalysisAction", () => ({ deleteAnalysisAction: vi.fn() }));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteAnalysisAction).mockResolvedValue({ ok: true, data: { deleted: true } });
});

afterEach(cleanup);

const mount = () => render(<DeleteAnalysis resumeId={RESUME_ID} jobTitle="Backend Engineer" companyName="Northwind" />);

async function openDialog() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /delete analysis/i }));
  });
}

/** The dialog's own confirm button, not the trigger that shares its label. */
const confirmButton = () => within(screen.getByRole("alertdialog")).getByRole("button", { name: /delete analysis/i });

describe("DeleteAnalysis", () => {
  it("asks first, saying what goes, and deletes nothing until confirmed", async () => {
    mount();
    expect(deleteAnalysisAction).not.toHaveBeenCalled();

    await openDialog();

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toMatch(/delete this analysis\?/i);
    expect(dialog.textContent).toMatch(/the cv, the analysis, every rehearsal and its feedback/i);
    expect(deleteAnalysisAction).not.toHaveBeenCalled();
  });

  it("keeps the analysis on cancel", async () => {
    mount();
    await openDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /keep it/i }));
    });

    expect(deleteAnalysisAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("deletes on confirm and goes to the analyses list", async () => {
    mount();
    await openDialog();
    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect(deleteAnalysisAction).toHaveBeenCalledWith({ resumeId: RESUME_ID });
    expect(push).toHaveBeenCalledWith("/resume/analyses");
  });

  it("shows the busy refusal as a toast and closes the dialog, leaving the page", async () => {
    vi.mocked(deleteAnalysisAction).mockResolvedValue({ ok: false, code: "ANALYSIS_BUSY" });
    mount();
    await openDialog();
    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect(toast.error).toHaveBeenCalledWith("An interview for this analysis is in progress. Try again when it ends.");
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("treats a rejected action as a failed request", async () => {
    vi.mocked(deleteAnalysisAction).mockRejectedValue(new Error("deployment changed"));
    mount();
    await openDialog();
    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/didn't go through/));
  });
});
