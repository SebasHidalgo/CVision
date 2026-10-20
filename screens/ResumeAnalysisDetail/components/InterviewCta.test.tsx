// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterviewQuotaView } from "@/lib/plans";
import type { InterviewAttempt } from "@/types/resume";
import InterviewCta, { interviewOffer } from "./InterviewCta";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/screens/ResumeAnalysisDetail/actions/createInterviewAction", () => ({
  createInterviewAction: vi.fn(),
}));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";
const RESETS = "2026-11-01T00:00:00.000Z";

const attempt = (id: string, status: InterviewAttempt["status"], attemptNumber: number): InterviewAttempt => ({
  id,
  status,
  attemptNumber,
  totalScore: status === "COMPLETED" ? 60 : null,
  createdAt: "2026-10-01T00:00:00.000Z",
});

const free = (trialAvailable: boolean): InterviewQuotaView => ({ plan: "FREE", trialAvailable, left: 0, limit: 0, resetsAt: RESETS });
const pro = (left: number): InterviewQuotaView => ({ plan: "PRO", trialAvailable: false, left, limit: 4, resetsAt: RESETS });

function mount(quota: InterviewQuotaView, attempts: InterviewAttempt[] = [], variant: "compact" | "full" = "full") {
  return render(
    <InterviewCta resumeId={RESUME_ID} jobTitle="Backend Engineer" attempts={attempts} quota={quota} variant={variant} />,
  );
}

afterEach(cleanup);

describe("interviewOffer", () => {
  it("is decided by the plan and the ledger, the live attempt first", () => {
    expect(interviewOffer(free(true), true)).toEqual({ kind: "live" });
    expect(interviewOffer(free(true), false)).toEqual({ kind: "trial" });
    expect(interviewOffer(free(false), false)).toEqual({ kind: "needs-pro" });
    expect(interviewOffer(pro(3), false)).toEqual({ kind: "pro", left: 3, limit: 4 });
    expect(interviewOffer(pro(0), false)).toEqual({ kind: "pro-exhausted", resetsAt: RESETS });
  });
});

describe("InterviewCta by plan", () => {
  it("offers a Free account its five-minute trial", () => {
    mount(free(true));

    expect(screen.getByRole("button", { name: /try a 5-minute interview, free/i })).toBeTruthy();
    expect(screen.getByText(/5 minutes with the interviewer, on us/)).toBeTruthy();
  });

  it("tells a Free account that used the trial that interviews are part of Pro, with no button", () => {
    mount(free(false), [attempt("i1", "COMPLETED", 1)]);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByText("Voice interviews are part of Pro.").length).toBeGreaterThan(0);
  });

  it("tells a Pro account how many interviews are left this month, and never how many analyses it gets", () => {
    const { container } = mount(pro(3), [attempt("i1", "COMPLETED", 1)]);

    expect(screen.getByRole("button", { name: /rehearse again/i })).toBeTruthy();
    expect(screen.getByText(/3 of 4 interviews left this month/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/50/);
    expect(container.textContent).not.toMatch(/analys/i);
  });

  it("at zero, tells a Pro account when the interviews come back, with no button", () => {
    mount(pro(0));

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByText(/You've used this month's interviews\. They reset Nov 1\./).length).toBeGreaterThan(0);
  });

  it("links to the live attempt before anything else, whatever the plan says", () => {
    mount(free(false), [attempt("i3", "IN_PROGRESS", 3), attempt("i2", "COMPLETED", 2)]);

    expect(screen.getByRole("link", { name: /open the interview room/i }).getAttribute("href")).toBe("/interview/i3");
    expect(screen.queryByText("Voice interviews are part of Pro.")).toBeNull();
  });

  it("the compact variant renders only the control", () => {
    mount(pro(2), [], "compact");

    expect(screen.getByRole("button", { name: /rehearse the interview/i })).toBeTruthy();
    expect(screen.queryByText(/interviews left/)).toBeNull();
  });
});
