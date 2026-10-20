// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisQuotaView } from "@/lib/plans";
import UploadForm, { quotaLine } from "./UploadForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/screens/ResumeUpload/actions/analyzeResumeAction", () => ({ analyzeResumeAction: vi.fn() }));
vi.mock("@/screens/ResumeUpload/actions/createResumeUploadAction", () => ({ createResumeUploadAction: vi.fn() }));

const RESETS = "2026-11-01T00:00:00.000Z";
const free = (left: number): AnalysisQuotaView => ({ plan: "FREE", left, limit: 3, announce: true, resetsAt: RESETS });
const pro = (left: number): AnalysisQuotaView => ({ plan: "PRO", left, limit: 50, announce: false, resetsAt: RESETS });

afterEach(cleanup);

describe("quotaLine", () => {
  it("announces the Free allowance with its reset, says nothing for Pro, and at zero says why for either", () => {
    expect(quotaLine(free(2))).toBe("2 of 3 analyses left this month · resets Nov 1");
    expect(quotaLine(free(1))).toBe("1 of 3 analysis left this month · resets Nov 1");
    expect(quotaLine(pro(40))).toBeNull();
    expect(quotaLine(free(0))).toBe("You've used this month's analyses. Resets Nov 1.");
    expect(quotaLine(pro(0))).toBe("You've reached this month's fair-use limit. Resets Nov 1.");
  });
});

describe("UploadForm and the analysis quota", () => {
  it("shows a Free account its remaining analyses and lets it upload", () => {
    const { container } = render(<UploadForm quota={free(2)} />);

    expect(screen.getByText("2 of 3 analyses left this month · resets Nov 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /run the analysis/i }).hasAttribute("disabled")).toBe(false);
    expect(container.querySelector("[aria-disabled=true]")).toBeNull();
  });

  it("shows a Pro account nothing about analyses while under the cap", () => {
    const { container } = render(<UploadForm quota={pro(40)} />);

    expect(container.textContent).not.toMatch(/analyses left|50|fair-use/);
    expect(screen.getByText("Runs while you wait · takes seconds")).toBeTruthy();
  });

  it("at zero, disables the file control and the submit and says when the quota resets", () => {
    const { container } = render(<UploadForm quota={free(0)} />);

    expect(screen.getByRole("status").textContent).toBe("You've used this month's analyses. Resets Nov 1.");
    expect(screen.getByRole("button", { name: /run the analysis/i }).hasAttribute("disabled")).toBe(true);
    // The dropzone root is marked disabled; react-dropzone ignores drops and clicks on it.
    expect(container.querySelector("[aria-disabled=true]")).not.toBeNull();
  });

  it("at Pro's fair-use cap, says so without the number", () => {
    const { container } = render(<UploadForm quota={pro(0)} />);

    expect(screen.getByRole("status").textContent).toBe("You've reached this month's fair-use limit. Resets Nov 1.");
    expect(container.textContent).not.toMatch(/50/);
    expect(screen.getByRole("button", { name: /run the analysis/i }).hasAttribute("disabled")).toBe(true);
  });
});
