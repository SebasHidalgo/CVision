// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionErrorCopy, resetDateCopy } from "@/lib/error/actionErrorCopy";
import type { Locale } from "@/lib/i18n/config";
import { tFor } from "@/lib/i18n/testing";
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

const copy = (locale: Locale) => ({
  t: tFor("upload", locale),
  errorCopy: (code: Parameters<typeof actionErrorCopy>[2], meta?: Parameters<typeof actionErrorCopy>[3]) =>
    actionErrorCopy(tFor("errors", locale), locale, code, meta),
  resetDate: (resetsAt: string) => resetDateCopy(resetsAt, locale),
});

describe("quotaLine", () => {
  it("announces the Free allowance with its reset, says nothing for Pro, and at zero says why for either", () => {
    const en = copy("en");
    expect(quotaLine(free(2), en)).toBe("2 of 3 analyses left this month · resets Nov 1");
    expect(quotaLine(free(1), en)).toBe("1 of 3 analyses left this month · resets Nov 1");
    expect(quotaLine(pro(40), en)).toBeNull();
    expect(quotaLine(free(0), en)).toBe("You've used this month's analyses. Resets Nov 1.");
    expect(quotaLine(pro(0), en)).toBe("You've reached this month's fair-use limit. Resets Nov 1.");
  });

  it("takes the noun's number from the allowance, not from what is left", () => {
    const en = copy("en");
    const single = { ...free(1), limit: 1 };
    expect(quotaLine(single, en)).toBe("1 of 1 analysis left this month · resets Nov 1");
    expect(quotaLine(single, copy("es"))).toBe("Tienes 1 de 1 análisis disponible este mes · se reinicia el 1 nov");
  });

  it("says the same in Spanish, whatever is left", () => {
    const es = copy("es");
    expect(quotaLine(free(2), es)).toBe("Tienes 2 de 3 análisis disponibles este mes · se reinician el 1 nov");
    expect(quotaLine(free(1), es)).toBe("Tienes 1 de 3 análisis disponibles este mes · se reinician el 1 nov");
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
