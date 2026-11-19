// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteHiddenAnalysesAction } from "@/screens/ResumeAnalyses/actions/deleteHiddenAnalysesAction";
import { deleteOneAnalysisAction } from "@/screens/ResumeAnalyses/actions/deleteOneAnalysisAction";
import { HiddenAnalyses, type HiddenItem } from "./HiddenAnalyses";

// The dialog carries the design system's face (next/font, which only runs under Next).
vi.mock("next/font/google", () => ({ Host_Grotesk: () => ({ variable: "font-text" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/screens/ResumeAnalyses/actions/deleteOneAnalysisAction", () => ({ deleteOneAnalysisAction: vi.fn() }));
vi.mock("@/screens/ResumeAnalyses/actions/deleteHiddenAnalysesAction", () => ({ deleteHiddenAnalysesAction: vi.fn() }));

const ITEMS: HiddenItem[] = [
  { id: "a2", n: "04", jobTitle: "Data Analyst", companyName: "Northwind", date: "Nov 2, 2026", dateTime: "2026-11-02T00:00:00.000Z", interviews: 2 },
  { id: "a1", n: "05", jobTitle: "Backend Engineer", companyName: "Contoso", date: "Oct 9, 2026", dateTime: "2026-10-09T00:00:00.000Z", interviews: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteOneAnalysisAction).mockResolvedValue({ ok: true, data: { deleted: true } });
  vi.mocked(deleteHiddenAnalysesAction).mockResolvedValue({ ok: true, data: { deleted: 2, busy: 0, failed: 0, remaining: 0 } });
});

afterEach(cleanup);

const block = () => document.querySelector("[data-hidden-analyses]") as HTMLElement;
const outcome = () => document.querySelector("[data-deletion-outcome]") as HTMLElement;
const dialog = () => screen.getByRole("alertdialog");

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("HiddenAnalyses", () => {
  it("says how many are hidden and why, links to Pro, and lists each by company, role and date without a link to open it", () => {
    render(<HiddenAnalyses items={ITEMS} limit={3} />);
    expect(block().textContent).toMatch(/2 older analyses are hidden/);
    expect(block().textContent).toMatch(/Free shows your last 3 analyses\. The older ones stay stored, CVs and interviews included, until you delete them\. Pro shows them all again\./);
    expect(within(block()).getByRole("link", { name: "See Pro" }).getAttribute("href")).toBe("/pricing");
    // The only link in the block is the Pro one: hidden analyses never open.
    expect(within(block()).getAllByRole("link")).toHaveLength(1);

    const rows = block().querySelectorAll("[data-hidden-analysis]");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Northwind");
    expect(rows[0].textContent).toContain("Data Analyst");
    expect(rows[0].textContent).toContain("Nov 2, 2026");
    expect(within(block()).getByRole("button", { name: "Delete all 2" })).toBeTruthy();
    expect(within(block()).getByRole("button", { name: "Delete Backend Engineer at Contoso, Oct 9, 2026" })).toBeTruthy();
  });

  it("renders nothing but an empty outcome line when nothing is hidden", () => {
    render(<HiddenAnalyses items={[]} limit={3} />);
    expect(block()).toBeNull();
    expect(outcome().textContent).toBe("");
  });

  it("deletes one after confirming, saying what goes (its interviews counted), and reports it", async () => {
    render(<HiddenAnalyses items={ITEMS} limit={3} />);
    await click(screen.getByRole("button", { name: "Delete Data Analyst at Northwind, Nov 2, 2026" }));
    expect(dialog().textContent).toMatch(/Delete this analysis\?/);
    expect(dialog().textContent).toMatch(/Data Analyst at Northwind, Nov 2, 2026: the CV, the analysis and its 2 interviews, with their transcripts and feedback, go with it\. This can't be undone\./);
    expect(deleteOneAnalysisAction).not.toHaveBeenCalled();

    await click(within(dialog()).getByRole("button", { name: "Delete analysis" }));
    expect(deleteOneAnalysisAction).toHaveBeenCalledWith({ resumeId: "a2" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(outcome().textContent).toBe("Deleted Data Analyst at Northwind.");
    expect(document.activeElement).toBe(outcome());
  });

  it("names no interviews for an analysis without any, and says so for one with exactly one", async () => {
    const { rerender } = render(<HiddenAnalyses items={ITEMS} limit={3} />);
    await click(screen.getByRole("button", { name: "Delete Backend Engineer at Contoso, Oct 9, 2026" }));
    expect(dialog().textContent).toMatch(/Backend Engineer at Contoso, Oct 9, 2026: the CV and the analysis go with it\. This can't be undone\./);
    await click(within(dialog()).getByRole("button", { name: "Keep it" }));

    rerender(<HiddenAnalyses items={[{ ...ITEMS[0], interviews: 1 }]} limit={3} />);
    await click(screen.getByRole("button", { name: "Delete Data Analyst at Northwind, Nov 2, 2026" }));
    expect(dialog().textContent).toMatch(/the CV, the analysis and its interview, with its transcript and feedback, go with it\./);
    await click(within(dialog()).getByRole("button", { name: "Keep it" }));
    await click(screen.getByRole("button", { name: "Delete it" }));
    expect(dialog().textContent).toMatch(/Their CVs, the analyses, and 1 interview with its transcript and feedback go with them\. Your last 3 stay\./);
  });

  it("keeps everything on cancel, and gives focus back to the button that opened the dialog", async () => {
    render(<HiddenAnalyses items={ITEMS} limit={3} />);
    const opener = screen.getByRole("button", { name: "Delete all 2" });
    opener.focus();
    await click(opener);
    await click(within(dialog()).getByRole("button", { name: "Keep them" }));
    expect(deleteHiddenAnalysesAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("deletes all the listed ones after confirming, sending the ids it showed", async () => {
    render(<HiddenAnalyses items={ITEMS} limit={3} />);
    await click(screen.getByRole("button", { name: "Delete all 2" }));
    expect(dialog().textContent).toMatch(/Delete 2 older analyses\?/);
    expect(dialog().textContent).toMatch(/Their CVs, the analyses and their 2 interviews, with transcripts and feedback, go with them\. Your last 3 stay\. This can't be undone\./);

    await click(within(dialog()).getByRole("button", { name: "Delete 2" }));
    expect(deleteHiddenAnalysesAction).toHaveBeenCalledWith({ ids: ["a2", "a1"] });
    expect(outcome().textContent).toBe("Deleted 2 analyses.");
  });

  it("reports a partial result honestly", async () => {
    vi.mocked(deleteHiddenAnalysesAction).mockResolvedValue({ ok: true, data: { deleted: 1, busy: 1, failed: 0, remaining: 0 } });
    render(<HiddenAnalyses items={ITEMS} limit={3} />);
    await click(screen.getByRole("button", { name: "Delete all 2" }));
    await click(within(dialog()).getByRole("button", { name: "Delete 2" }));
    expect(outcome().textContent).toBe("Deleted 1 analysis. 1 wasn't deleted: an interview for it is in progress. Try again when it ends.");
  });

  it("shows the refusal's copy, and a rejected call as a failed request", async () => {
    vi.mocked(deleteOneAnalysisAction).mockResolvedValue({ ok: false, code: "ANALYSIS_BUSY" });
    render(<HiddenAnalyses items={ITEMS} limit={3} />);
    await click(screen.getByRole("button", { name: "Delete Backend Engineer at Contoso, Oct 9, 2026" }));
    await click(within(dialog()).getByRole("button", { name: "Delete analysis" }));
    expect(outcome().textContent).toBe("An interview for this analysis is in progress. Try again when it ends.");

    vi.mocked(deleteHiddenAnalysesAction).mockRejectedValue(new Error("deployment changed"));
    await click(screen.getByRole("button", { name: "Delete all 2" }));
    await click(within(dialog()).getByRole("button", { name: "Delete 2" }));
    expect(outcome().textContent).toMatch(/didn't go through/);
  });
});
