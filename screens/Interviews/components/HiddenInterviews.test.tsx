// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteHiddenInterviewsAction } from "@/screens/Interviews/actions/deleteHiddenInterviewsAction";
import { deleteOneInterviewAction } from "@/screens/Interviews/actions/deleteOneInterviewAction";
import { HiddenInterviews, type HiddenInterviewItem } from "./HiddenInterviews";

// The dialog carries the design system's face (next/font, which only runs under Next).
vi.mock("next/font/google", () => ({ Host_Grotesk: () => ({ variable: "font-text" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/screens/Interviews/actions/deleteOneInterviewAction", () => ({ deleteOneInterviewAction: vi.fn() }));
vi.mock("@/screens/Interviews/actions/deleteHiddenInterviewsAction", () => ({ deleteHiddenInterviewsAction: vi.fn() }));

const ITEMS: HiddenInterviewItem[] = [
  { id: "i2", n: "03", role: "Data Analyst", companyName: "Northwind", date: "Nov 2, 2026", dateTime: "2026-11-02T00:00:00.000Z" },
  { id: "i1", n: "04", role: "Backend Engineer", companyName: "Contoso", date: "Oct 9, 2026", dateTime: "2026-10-09T00:00:00.000Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteOneInterviewAction).mockResolvedValue({ ok: true, data: { deleted: true } });
  vi.mocked(deleteHiddenInterviewsAction).mockResolvedValue({ ok: true, data: { deleted: 2, busy: 0, failed: 0, remaining: 0 } });
});

afterEach(cleanup);

const block = () => document.querySelector("[data-hidden-interviews]") as HTMLElement;
const outcome = () => document.querySelector("[data-deletion-outcome]") as HTMLElement;
const dialog = () => screen.getByRole("alertdialog");

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("HiddenInterviews", () => {
  it("says how many are hidden and why, links to Pro, and lists each by company, role and date without a link to open it", () => {
    render(<HiddenInterviews items={ITEMS} limit={3} />);
    expect(block().textContent).toMatch(/2 interviews are hidden/);
    expect(block().textContent).toMatch(/Free shows your last 3 analyses and their interviews; these belong to older analyses\..*Pro shows them all again\./);
    expect(within(block()).getByRole("link", { name: "See Pro" }).getAttribute("href")).toBe("/pricing");
    // The only link in the block is the Pro one: hidden interviews never open.
    expect(within(block()).getAllByRole("link")).toHaveLength(1);
    // The analyses' attributes are not this block's.
    expect(document.querySelector("[data-hidden-analyses]")).toBeNull();

    const rows = block().querySelectorAll("[data-hidden-interview]");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Northwind");
    expect(rows[0].textContent).toContain("Data Analyst");
    expect(rows[0].textContent).toContain("Nov 2, 2026");
    expect(within(block()).getByRole("button", { name: "Delete all 2" })).toBeTruthy();
    expect(within(block()).getByRole("button", { name: "Delete the interview for Backend Engineer at Contoso, Oct 9, 2026" })).toBeTruthy();
  });

  it("renders nothing but an empty outcome line when nothing is hidden", () => {
    render(<HiddenInterviews items={[]} limit={3} />);
    expect(block()).toBeNull();
    expect(outcome().textContent).toBe("");
  });

  it("deletes one after confirming, saying it goes at the voice provider too and the analysis stays, and reports it", async () => {
    render(<HiddenInterviews items={ITEMS} limit={3} />);
    await click(screen.getByRole("button", { name: "Delete the interview for Data Analyst at Northwind, Nov 2, 2026" }));
    expect(dialog().textContent).toMatch(/Delete this interview\?/);
    expect(dialog().textContent).toMatch(/Data Analyst at Northwind, Nov 2, 2026: the interview, its transcript and its feedback are deleted, here and at our voice provider\. Its analysis stays\./);
    expect(deleteOneInterviewAction).not.toHaveBeenCalled();

    await click(within(dialog()).getByRole("button", { name: "Delete interview" }));
    expect(deleteOneInterviewAction).toHaveBeenCalledWith({ interviewId: "i2" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(outcome().textContent).toBe("Deleted the interview for Data Analyst at Northwind.");
    expect(document.activeElement).toBe(outcome());
  });

  it("keeps everything on cancel, and gives focus back to the row's button", async () => {
    render(<HiddenInterviews items={ITEMS} limit={3} />);
    const opener = screen.getByRole("button", { name: "Delete the interview for Backend Engineer at Contoso, Oct 9, 2026" });
    opener.focus();
    await click(opener);
    await click(within(dialog()).getByRole("button", { name: "Keep it" }));
    expect(deleteOneInterviewAction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("deletes all the listed ones after confirming, sending the ids it showed", async () => {
    render(<HiddenInterviews items={ITEMS} limit={3} />);
    await click(screen.getByRole("button", { name: "Delete all 2" }));
    expect(dialog().textContent).toMatch(/Delete 2 hidden interviews\?/);
    expect(dialog().textContent).toMatch(/Their analyses and the interviews you can see stay\. This can't be undone\./);

    await click(within(dialog()).getByRole("button", { name: "Delete 2" }));
    expect(deleteHiddenInterviewsAction).toHaveBeenCalledWith({ ids: ["i2", "i1"] });
    expect(outcome().textContent).toBe("Deleted 2 interviews.");
  });

  it("reports a partial result honestly, the refusal's copy, and a rejected call as a failed request", async () => {
    vi.mocked(deleteHiddenInterviewsAction).mockResolvedValue({ ok: true, data: { deleted: 1, busy: 1, failed: 0, remaining: 0 } });
    render(<HiddenInterviews items={ITEMS} limit={3} />);
    await click(screen.getByRole("button", { name: "Delete all 2" }));
    await click(within(dialog()).getByRole("button", { name: "Delete 2" }));
    expect(outcome().textContent).toBe("Deleted 1 interview. 1 wasn't deleted: it's in progress. Try again when it ends.");

    vi.mocked(deleteOneInterviewAction).mockResolvedValue({ ok: false, code: "ANALYSIS_BUSY" });
    await click(screen.getByRole("button", { name: "Delete the interview for Backend Engineer at Contoso, Oct 9, 2026" }));
    await click(within(dialog()).getByRole("button", { name: "Delete interview" }));
    expect(outcome().textContent).toBe("An interview for this analysis is in progress. Try again when it ends.");

    vi.mocked(deleteHiddenInterviewsAction).mockRejectedValue(new Error("deployment changed"));
    await click(screen.getByRole("button", { name: "Delete all 2" }));
    await click(within(dialog()).getByRole("button", { name: "Delete 2" }));
    expect(outcome().textContent).toMatch(/didn't go through/);
  });
});
