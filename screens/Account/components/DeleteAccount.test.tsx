// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccountAction } from "../actions/deleteAccountAction";
import DeleteAccount, { LEAVE_FALLBACK_MS } from "./DeleteAccount";

// The design system's face comes from next/font, which only runs under Next.
vi.mock("next/font/google", () => ({ Host_Grotesk: () => ({ variable: "font-text" }) }));

const clerk = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => clerk }));
vi.mock("../actions/deleteAccountAction", () => ({ deleteAccountAction: vi.fn() }));

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  clerk.signOut.mockResolvedValue(undefined);
  vi.mocked(deleteAccountAction).mockResolvedValue({ ok: true, data: { deleted: true } });
  Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const openDialog = () => fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));

describe("DeleteAccount", () => {
  it("asks first, naming what goes; keeping the account deletes nothing", () => {
    render(<DeleteAccount subscribed={false} />);
    openDialog();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Delete your account?");
    expect(dialog.textContent).toContain("Deleted now: your analyses and CVs; your interviews with their transcripts, feedback and translations;");
    expect(dialog.textContent).toContain("Paddle keeps your invoices and customer record as tax records.");
    fireEvent.click(screen.getByRole("button", { name: "Keep my account" }));
    expect(deleteAccountAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says a subscription ends with the account when there is one", () => {
    render(<DeleteAccount subscribed />);
    openDialog();
    expect(screen.getByRole("alertdialog").textContent).toContain("Your subscription is canceled at once, so Pro ends now, not at the end of the period.");
  });

  it("deletes with an explicit yes, says so, then signs out to the home page", async () => {
    render(<DeleteAccount subscribed={false} />);
    openDialog();
    confirm();
    await waitFor(() => expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: "/" }));
    expect(deleteAccountAction).toHaveBeenCalledWith({ confirm: true });
    expect(screen.getByRole("status").textContent).toBe("Your account is deleted. Signing you out…");
    expect(screen.queryByRole("button", { name: "Delete account" })).toBeNull();
  });

  it("goes home by hand when signing out fails (the session is already gone at Clerk)", async () => {
    clerk.signOut.mockRejectedValueOnce(new Error("session not found"));
    render(<DeleteAccount subscribed={false} />);
    openDialog();
    confirm();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("goes home by hand when signing out never leaves the page", async () => {
    clerk.signOut.mockImplementationOnce(() => new Promise(() => {}));
    render(<DeleteAccount subscribed={false} />);
    openDialog();
    vi.useFakeTimers();
    await act(async () => {
      confirm();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(clerk.signOut).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAVE_FALLBACK_MS);
    });
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("keeps the account and says why under the button when the deletion is refused; signs nobody out", async () => {
    vi.mocked(deleteAccountAction).mockResolvedValueOnce({ ok: false, code: "ACCOUNT_DELETION_FAILED" });
    render(<DeleteAccount subscribed={false} />);
    openDialog();
    confirm();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("We couldn't delete your account, and nothing was removed. Try again in a few minutes."));
    expect(clerk.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete account" })).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // A new attempt clears the old message.
    openDialog();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats a rejected call (network, a stale deployment) as a refusal", async () => {
    vi.mocked(deleteAccountAction).mockRejectedValueOnce(new TypeError("fetch failed"));
    render(<DeleteAccount subscribed={false} />);
    openDialog();
    confirm();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(clerk.signOut).not.toHaveBeenCalled();
  });
});
