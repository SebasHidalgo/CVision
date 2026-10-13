// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterviewAttempt } from "@/types/resume";
import InterviewCta from "./InterviewCta";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/screens/ResumeAnalysisDetail/actions/createInterviewAction", () => ({
  createInterviewAction: vi.fn(),
}));

const RESUME_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

const attempt = (id: string, status: InterviewAttempt["status"], attemptNumber: number): InterviewAttempt => ({
  id,
  status,
  attemptNumber,
  totalScore: status === "COMPLETED" ? 60 : null,
  createdAt: "2026-10-01T00:00:00.000Z",
});

function mount(attempts: InterviewAttempt[], variant: "compact" | "full" = "full") {
  return render(
    <InterviewCta resumeId={RESUME_ID} jobTitle="Backend Engineer" attempts={attempts} variant={variant} />,
  );
}

afterEach(cleanup);

describe("InterviewCta and the provisional cap", () => {
  it("offers the first rehearsal with no count shown", () => {
    mount([]);

    expect(screen.getByRole("button", { name: /rehearse the interview/i })).toBeTruthy();
    expect(screen.queryByText(/rehearsals used/)).toBeNull();
  });

  it("offers to rehearse again below the cap and says how many rehearsals are used", () => {
    mount([attempt("i2", "COMPLETED", 2), attempt("i1", "COMPLETED", 1)]);

    expect(screen.getByRole("button", { name: /rehearse again/i })).toBeTruthy();
    expect(screen.getByText(/2 of 3 rehearsals used/)).toBeTruthy();
  });

  it("at the cap, hides the button and says every rehearsal is used, in both variants", () => {
    const used = [attempt("i3", "COMPLETED", 3), attempt("i2", "FEEDBACK_PENDING", 2), attempt("i1", "COMPLETED", 1)];
    mount(used);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("3 of 3 rehearsals used")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /every rehearsal of this posting is used/i })).toBeTruthy();
    cleanup();

    mount(used, "compact");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("3 of 3 rehearsals used")).toBeTruthy();
  });

  it("does not count FAILED or EXPIRED attempts toward the cap", () => {
    mount([
      attempt("i4", "FAILED", 4),
      attempt("i3", "COMPLETED", 3),
      attempt("i2", "EXPIRED", 2),
      attempt("i1", "COMPLETED", 1),
    ]);

    expect(screen.getByRole("button", { name: /rehearse again/i })).toBeTruthy();
    expect(screen.getByText(/2 of 3 rehearsals used/)).toBeTruthy();
  });

  it("links to the live attempt before anything else, cap or not", () => {
    mount([attempt("i3", "IN_PROGRESS", 3), attempt("i2", "COMPLETED", 2), attempt("i1", "COMPLETED", 1)]);

    expect(screen.getByRole("link", { name: /open the interview room/i }).getAttribute("href")).toBe("/interview/i3");
    expect(screen.queryByText(/rehearsals used/)).toBeNull();
  });
});
