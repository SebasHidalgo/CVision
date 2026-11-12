// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideEntitlement } from "@/lib/interviewEntitlement";
import { PLANS, type InterviewQuotaView } from "@/lib/plans";
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

const attempt = (id: string, status: InterviewAttempt["status"], attemptNumber: number, failureReason: string | null = null): InterviewAttempt => ({
  id,
  status,
  attemptNumber,
  failureReason,
  totalScore: status === "COMPLETED" ? 60 : null,
  createdAt: "2026-10-01T00:00:00.000Z",
  startCount: 0,
  held: false,
  resumableUntil: null,
});
const held = { startCount: 1, held: true, resumableUntil: null };
const waiting = { startCount: 0, held: false, resumableUntil: null };

/** A view with the entitlement the ledger would have decided from the same numbers. */
const free = (trialAvailable: boolean, credits = 0): InterviewQuotaView => ({
  plan: "FREE",
  trialAvailable,
  left: 0,
  limit: 0,
  credits,
  entitlement: decideEntitlement({ plan: "FREE", periodUsed: 0, credits, trialsUsed: trialAvailable ? 0 : 1, hadVoice: false, periodEnd: new Date(RESETS) }),
  resetsAt: RESETS,
});
const pro = (left: number, credits = 0): InterviewQuotaView => ({
  plan: "PRO",
  trialAvailable: false,
  left,
  limit: 4,
  credits,
  entitlement: decideEntitlement({ plan: "PRO", periodUsed: 4 - left, credits, trialsUsed: 0, hadVoice: true, periodEnd: new Date(RESETS) }),
  resetsAt: RESETS,
});

function mount(quota: InterviewQuotaView, attempts: InterviewAttempt[] = [], variant: "compact" | "full" = "full") {
  return render(
    <InterviewCta resumeId={RESUME_ID} jobTitle="Backend Engineer" attempts={attempts} quota={quota} variant={variant} />,
  );
}

afterEach(cleanup);

describe("interviewOffer", () => {
  it("is decided by the plan and the ledger, the live attempt first", () => {
    expect(interviewOffer(free(true), waiting)).toEqual({ kind: "live" });
    expect(interviewOffer(free(false), held)).toEqual({ kind: "live" });
    // A waiting attempt the plan cannot start offers what to buy, as the room does.
    expect(interviewOffer(free(false), waiting)).toEqual({ kind: "needs-pro" });
    expect(interviewOffer(pro(0), waiting)).toEqual({ kind: "pro-exhausted", resetsAt: RESETS });
    expect(interviewOffer(free(false), { ...waiting, resumableUntil: "2999-01-01T00:00:00.000Z" })).toEqual({ kind: "live" });
    expect(interviewOffer(free(true), null)).toEqual({ kind: "trial" });
    expect(interviewOffer(free(false), null)).toEqual({ kind: "needs-pro" });
    expect(interviewOffer(pro(3), null)).toEqual({ kind: "pro", left: 3, limit: 4, credits: 0 });
    expect(interviewOffer(pro(0), null)).toEqual({ kind: "pro-exhausted", resetsAt: RESETS });
    // Credits keep the button after the period's interviews are used, and give a Free account one too, before its trial.
    expect(interviewOffer(pro(0, 5), null)).toEqual({ kind: "pro", left: 0, limit: 4, credits: 5 });
    expect(interviewOffer(free(false, 5), null)).toEqual({ kind: "credits", credits: 5 });
    expect(interviewOffer(free(true, 1), null)).toEqual({ kind: "credits", credits: 1 });
  });
});

describe("InterviewCta by plan", () => {
  it("offers a Free account its five-minute trial", () => {
    mount(free(true));

    expect(screen.getByRole("button", { name: /free trial interview · 5 min/i })).toBeTruthy();
    expect(screen.getByText(/5 minutes with the interviewer, on us/)).toBeTruthy();
  });

  it("tells a Free account that used the trial that interviews are part of Pro, with no button, and Pro's numbers from the plans", () => {
    const { container } = mount(free(false), [attempt("i1", "COMPLETED", 1)]);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByText("Voice interviews are part of Pro.").length).toBeGreaterThan(0);
    expect(container.textContent).toContain(`Pro interviews run up to 12 minutes, ${PLANS.PRO.interviewsPerMonth} a month`);
    expect(container.textContent).not.toMatch(/twelve|four a month/);
  });

  it("tells a Pro account how many interviews are left this period, the credits when it has any, and never how many analyses it gets", () => {
    const { container } = mount(pro(3), [attempt("i1", "COMPLETED", 1)]);

    expect(screen.getByRole("button", { name: /rehearse again/i })).toBeTruthy();
    expect(screen.getByText(/3 of 4 interviews left this period · up to 12 minutes/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/50/);
    expect(container.textContent).not.toMatch(/analys/i);

    cleanup();
    mount(pro(3, 5));
    expect(screen.getByText(/3 of 4 interviews left this period · 5 credits/)).toBeTruthy();
  });

  it("offers a Free account with pack credits the full interview, counting its credits, with no mention of Pro's number", () => {
    const { container } = mount(free(false, 3), [attempt("i1", "COMPLETED", 1)]);

    expect(screen.getByRole("button", { name: /rehearse again/i })).toBeTruthy();
    expect(screen.getByText(/3 credits left · up to 12 minutes · needs a microphone/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/part of Pro/);
    expect(container.textContent).not.toMatch(/of 4 interviews/);

    cleanup();
    mount(free(false, 1));
    expect(screen.getByRole("button", { name: /rehearse the interview/i })).toBeTruthy();
    expect(screen.getByText(/1 credit left/)).toBeTruthy();
  });

  it("at zero, tells a Pro account when the interviews come back, with no button", () => {
    mount(pro(0));

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByText(/You've used this period's interviews\. They reset Nov 1\./).length).toBeGreaterThan(0);
  });

  it("links to a live attempt that holds its unit, whatever the plan says", () => {
    mount(free(false), [{ ...attempt("i3", "IN_PROGRESS", 3), startCount: 1, held: true }, attempt("i2", "COMPLETED", 2)]);

    expect(screen.getByRole("link", { name: /open the interview room/i }).getAttribute("href")).toBe("/interview/i3");
    expect(screen.queryByText("Voice interviews are part of Pro.")).toBeNull();
  });

  it("offers Pro, not the room, for a waiting attempt the plan cannot start", () => {
    mount(free(false), [attempt("i3", "SCHEDULED", 3)]);

    expect(screen.queryByRole("link", { name: /open the interview room/i })).toBeNull();
    expect(screen.getByText("Voice interviews are part of Pro.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /see what pro includes/i }).getAttribute("href")).toBe("/pricing");
  });

  it("says \"again\" only after a rehearsal that ran, not after expired or never-answered attempts", () => {
    const neverRan = [
      attempt("i3", "EXPIRED", 3, "ABANDONED"),
      attempt("i2", "FAILED", 2, "NO_CANDIDATE_TURNS"),
      attempt("i1", "FAILED", 1, "SESSION_LOST"),
    ];
    mount(pro(3), neverRan);
    expect(screen.getByRole("button", { name: /rehearse the interview/i })).toBeTruthy();
    expect(screen.queryByText("Rehearse it again.")).toBeNull();

    cleanup();
    mount(pro(3), [attempt("i2", "FAILED", 2, "FEEDBACK_FAILED"), ...neverRan.slice(1)]);
    expect(screen.getByRole("button", { name: /rehearse again/i })).toBeTruthy();
    expect(screen.getByText("Rehearse it again.")).toBeTruthy();

    cleanup();
    mount(pro(3), [attempt("i1", "FEEDBACK_PENDING", 1)]);
    expect(screen.getByRole("button", { name: /rehearse again/i })).toBeTruthy();
  });

  it("lets a long label wrap inside the button rather than overflow onto the text", () => {
    mount(free(true));

    const button = screen.getByRole("button", { name: /free trial interview/i });
    expect(button.className).toMatch(/\bwhitespace-normal\b/);
    expect(button.className).toMatch(/\bmax-w-full\b/);
    expect(button.className).not.toMatch(/(^|\s)h-1[12](\s|$)/);
  });

  it("the compact variant renders only the control", () => {
    mount(pro(2), [], "compact");

    expect(screen.getByRole("button", { name: /rehearse the interview/i })).toBeTruthy();
    expect(screen.queryByText(/interviews left/)).toBeNull();
  });
});
