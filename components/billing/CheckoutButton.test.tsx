// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createCheckoutAction } from "./actions/createCheckoutAction";
import CheckoutButton from "./CheckoutButton";
import { openCheckout, paddleEnvironmentOf } from "./paddle/paddleCheckout";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./actions/createCheckoutAction", () => ({ createCheckoutAction: vi.fn() }));
vi.mock("./paddle/paddleCheckout", () => ({
  openCheckout: vi.fn(),
  paddleEnvironmentOf: (token: string | undefined) =>
    token?.startsWith("test_") ? "sandbox" : token?.startsWith("live_") ? "production" : null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createCheckoutAction).mockResolvedValue({ ok: true, data: { transactionId: "txn_01" } });
  vi.mocked(openCheckout).mockResolvedValue("completed");
});

afterEach(cleanup);

const mount = () => render(<CheckoutButton item="pro_monthly" label="Get Pro" afterCompleteHref="/account/billing?activating=pro_monthly" />);

describe("CheckoutButton", () => {
  it("asks the server for the transaction, opens the overlay on it, and navigates when the payment completes", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Get Pro" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/account/billing?activating=pro_monthly"));
    expect(createCheckoutAction).toHaveBeenCalledWith({ item: "pro_monthly" });
    expect(openCheckout).toHaveBeenCalledWith("txn_01", "dark");
    // The spinner stays until the navigation unmounts the button.
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  it("re-enables when the buyer closes the overlay without paying", async () => {
    vi.mocked(openCheckout).mockResolvedValueOnce("closed");
    mount();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button")).toHaveProperty("disabled", false));
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the refusal's copy and never opens the overlay", async () => {
    vi.mocked(createCheckoutAction).mockResolvedValueOnce({ ok: false, code: "PACK_REQUIRES_PRO" });
    mount();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Pro subscribers/)));
    expect(openCheckout).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveProperty("disabled", false);
  });

  it("handles the two ways the call itself can fail: the action rejected, or Paddle.js did not load", async () => {
    vi.mocked(createCheckoutAction).mockRejectedValueOnce(new Error("network"));
    mount();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/didn't go through/)));

    vi.mocked(openCheckout).mockRejectedValueOnce(new Error("Paddle.js is not available"));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Billing isn't responding/)));
  });
});

describe("paddleEnvironmentOf", () => {
  it("reads the environment off the client token's prefix, and refuses anything else", () => {
    expect(paddleEnvironmentOf("test_abc")).toBe("sandbox");
    expect(paddleEnvironmentOf("live_abc")).toBe("production");
    expect(paddleEnvironmentOf("abc")).toBeNull();
    expect(paddleEnvironmentOf(undefined)).toBeNull();
  });
});
