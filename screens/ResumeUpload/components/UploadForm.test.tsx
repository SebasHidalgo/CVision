// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionErrorCopy, resetDateCopy } from "@/lib/error/actionErrorCopy";
import type { Locale } from "@/lib/i18n/config";
import { tFor } from "@/lib/i18n/testing";
import type { AnalysisQuotaView } from "@/lib/plans";
import { analyzeResumeAction } from "@/screens/ResumeUpload/actions/analyzeResumeAction";
import { createResumeUploadAction } from "@/screens/ResumeUpload/actions/createResumeUploadAction";
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
    expect(quotaLine(pro(0), en)).toBe("You've used your 50 analyses for this period. They reset Nov 1.");
  });

  it("takes the noun's number from the allowance, not from what is left", () => {
    const en = copy("en");
    const single = { ...free(1), limit: 1 };
    expect(quotaLine(single, en)).toBe("1 of 1 analysis left this month · resets Nov 1");
    expect(quotaLine(single, copy("es"))).toBe("Tienes 1 de 1 análisis disponible este mes · se reinicia el 1 de noviembre");
  });

  it("says the same in Spanish, whatever is left", () => {
    const es = copy("es");
    expect(quotaLine(free(2), es)).toBe("Tienes 2 de 3 análisis disponibles este mes · se reinician el 1 de noviembre");
    expect(quotaLine(free(1), es)).toBe("Tienes 1 de 3 análisis disponibles este mes · se reinician el 1 de noviembre");
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
    expect(screen.getByText("Runs while you wait · usually under 20 seconds")).toBeTruthy();
  });

  it("at zero, disables the file control and the submit and says when the quota resets", () => {
    const { container } = render(<UploadForm quota={free(0)} />);

    expect(screen.getByRole("status").textContent).toBe("You've used this month's analyses. Resets Nov 1.");
    expect(screen.getByRole("button", { name: /run the analysis/i }).hasAttribute("disabled")).toBe(true);
    // The dropzone root is marked disabled; react-dropzone ignores drops and clicks on it.
    expect(container.querySelector("[aria-disabled=true]")).not.toBeNull();
  });

  it("at Free's zero, offers Pro next to the reset", () => {
    render(<UploadForm quota={free(0)} />);

    expect(screen.getByRole("link", { name: "See Pro" }).getAttribute("href")).toBe("/pricing");
    expect(screen.getByText("With Pro you get up to 50 analyses a month.")).toBeTruthy();
  });

  it("at Pro's cap, says so with the cap and offers nothing", () => {
    render(<UploadForm quota={pro(0)} />);

    expect(screen.getByRole("status").textContent).toBe("You've used your 50 analyses for this period. They reset Nov 1.");
    expect(screen.queryByRole("link", { name: "See Pro" })).toBeNull();
    expect(screen.getByRole("button", { name: /run the analysis/i }).hasAttribute("disabled")).toBe(true);
  });
});

describe("UploadForm: one key per submission", () => {
  const KEY = "cv/user_1/11111111-2222-4333-8444-555555555555.pdf";
  const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "cv.pdf", { type: "application/pdf", lastModified: 1 });

  const fill = async (company: string) => {
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: company } });
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Frontend Engineer" } });
    fireEvent.change(screen.getByLabelText("The posting"), { target: { value: "Build the checkout in React." } });
  };
  const pick = async (container: HTMLElement) => {
    const input = container.querySelector("input#resume") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pdf()], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText("cv.pdf")).toBeTruthy());
  };
  const submit = async (calls: number) => {
    fireEvent.click(screen.getByRole("button", { name: /run the analysis/i }));
    await waitFor(() => expect(vi.mocked(analyzeResumeAction)).toHaveBeenCalledTimes(calls));
    // The failed run hands the form back.
    await waitFor(() => expect(screen.getByRole("button", { name: /run the analysis/i })).toBeTruthy());
  };
  const keys = () => vi.mocked(analyzeResumeAction).mock.calls.map(([sent]) => (sent as { submissionKey: string }).submissionKey);

  it("sends the same key when the same submission is retried after a lost response, and a new one once a field changes", async () => {
    vi.mocked(analyzeResumeAction).mockReset();
    vi.mocked(createResumeUploadAction).mockResolvedValue({ ok: true, data: { resumeKey: KEY, uploadUrl: "https://storage.test/upload" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    // The response of the analysis never arrives: the action call itself rejects.
    vi.mocked(analyzeResumeAction).mockRejectedValue(new TypeError("Failed to fetch"));

    const { container } = render(<UploadForm quota={pro(40)} />);
    await fill("Northwind");
    await pick(container);

    await submit(1);
    // The failure takes focus, and nothing around it in the form is a live region that would read it again.
    const notice = await waitFor(() => {
      const focused = document.activeElement as HTMLElement;
      expect(focused.hasAttribute("data-failure-notice")).toBe(true);
      return focused;
    });
    for (let node: HTMLElement | null = notice; node; node = node.parentElement) {
      expect(node.hasAttribute("aria-live") || ["alert", "status", "log"].includes(node.getAttribute("role") ?? "")).toBe(false);
    }
    await submit(2);
    await fill("Contoso");
    await submit(3);

    const [first, retry, changed] = keys();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(retry).toBe(first);
    expect(changed).not.toBe(first);
  });
});

describe("UploadForm: a field in error", () => {
  it("draws every invalid control's edge in the danger text colour, the dropzone included, never in ink", async () => {
    const { container } = render(<UploadForm quota={pro(40)} />);
    fireEvent.click(screen.getByRole("button", { name: /run the analysis/i }));

    const fields = await waitFor(() => {
      const invalid = [...container.querySelectorAll<HTMLElement>("input[aria-invalid=true], textarea[aria-invalid=true]")].filter((el) => el.id !== "resume");
      expect(invalid.map((el) => el.id).sort()).toEqual(["company-name", "job-description", "job-title"]);
      return invalid;
    });
    for (const field of fields) {
      expect(field.className).toContain("aria-invalid:border-danger-text");
      expect(field.className).toContain("aria-invalid:focus:border-danger-text");
      expect(field.className).not.toContain("aria-invalid:border-ink");
    }
    const dropzone = container.querySelector<HTMLElement>("#resume-drop");
    expect(dropzone?.className.split(/\s+/)).toEqual(expect.arrayContaining(["border-danger-text", "hover:border-danger-text"]));
    expect(dropzone?.className.split(/\s+/)).not.toContain("hover:border-ink-2");
  });
});
