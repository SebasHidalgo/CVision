// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPortalSessionAction } from "./actions/createPortalSessionAction";
import ManageSubscriptionButton, { openPortal } from "./ManageSubscriptionButton";

vi.mock("./actions/createPortalSessionAction", () => ({ createPortalSessionAction: vi.fn() }));

const PORTAL = "https://sandbox-customer-portal.paddle.com/cpl_01";

const open = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("open", open);
  open.mockReturnValue({ opener: {} });
  Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true, configurable: true });
  vi.mocked(createPortalSessionAction).mockResolvedValue({ ok: true, data: { url: PORTAL } });
});

afterEach(cleanup);

describe("ManageSubscriptionButton", () => {
  it("opens no tab until the link exists, then opens it in a new tab with no opener", async () => {
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));
    // Still minting: nothing opened yet.
    expect(open).not.toHaveBeenCalled();

    await waitFor(() => expect(open).toHaveBeenCalledWith(PORTAL, "_blank"));
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button")).toHaveProperty("disabled", false));
  });

  it("falls back to this tab when the browser blocks the late popup", () => {
    open.mockReturnValueOnce(null);
    expect(openPortal(PORTAL)).toBe("here");
    expect(assign).toHaveBeenCalledWith(PORTAL);

    const tab = { opener: {} as unknown };
    open.mockReturnValueOnce(tab);
    expect(openPortal(PORTAL)).toBe("tab");
    expect(tab.opener).toBeNull();
  });

  it("shows a failure under the button, opens nothing, and never blames the user", async () => {
    vi.mocked(createPortalSessionAction).mockResolvedValueOnce({ ok: false, code: "BILLING_PORTAL_UNAVAILABLE" });
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Billing management is temporarily unavailable. Try again later."));
    expect(open).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveProperty("disabled", false);

    // The message clears on the next attempt.
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the call itself did not go through", async () => {
    vi.mocked(createPortalSessionAction).mockRejectedValueOnce(new Error("network"));
    render(<ManageSubscriptionButton />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/didn't go through/));
    expect(open).not.toHaveBeenCalled();
  });
});
