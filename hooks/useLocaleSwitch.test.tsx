// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranslation } from "react-i18next";
import I18nProvider from "@/components/providers/I18nProvider";
import { RESOURCES } from "@/lib/i18n/resources";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (message: string) => toastError(message) } }));
const setLocaleAction = vi.fn();
vi.mock("@/components/i18n/actions/setLocaleAction", () => ({ setLocaleAction: (input: unknown) => setLocaleAction(input) }));
const loadMessagesAction = vi.fn();
vi.mock("@/components/i18n/actions/loadMessagesAction", () => ({ loadMessagesAction: (input: unknown) => loadMessagesAction(input) }));

const { useLocaleSwitch } = await import("./useLocaleSwitch");

function Probe() {
  const { t } = useTranslation("common");
  const { current, switchTo, prefetch } = useLocaleSwitch();
  return (
    <div>
      <p data-testid="text">{t("translation.pending")}</p>
      <p data-testid="current">{current}</p>
      <button onClick={() => prefetch("es")}>prefetch</button>
      <button onClick={() => switchTo("es")}>switch</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <I18nProvider locale="en" resources={{ common: RESOURCES.en.common, errors: RESOURCES.en.errors }}>
      <Probe />
    </I18nProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  loadMessagesAction.mockImplementation(async ({ locale, namespaces }: { locale: "es"; namespaces: Array<"common" | "errors"> }) => ({
    ok: true,
    data: { locale, resources: Object.fromEntries(namespaces.map((ns) => [ns, RESOURCES[locale][ns]])) },
  }));
});
afterEach(cleanup);

describe("useLocaleSwitch", () => {
  it("switches the client strings before the server answers; the action's own re-render brings the server's", async () => {
    let answer: (value: unknown) => void = () => {};
    setLocaleAction.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderProbe();
    expect(screen.getByTestId("text").textContent).toBe("Translating…");
    await act(async () => screen.getByText("switch").click());
    await waitFor(() => expect(screen.getByTestId("text").textContent).toBe("Traduciendo…"));
    expect(screen.getByTestId("current").textContent).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    // The page's other namespaces came with one load, before the language changed.
    expect(loadMessagesAction).toHaveBeenCalledWith({ locale: "es", namespaces: ["common", "errors"] });
    expect(setLocaleAction).toHaveBeenCalledWith({ locale: "es" });
    await act(async () => answer({ ok: true, data: { locale: "es" } }));
    // Answered: still Spanish, nothing reverted, no toast.
    expect(screen.getByTestId("current").textContent).toBe("es");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("prefetches once on intent, so the click needs no second load", async () => {
    setLocaleAction.mockResolvedValue({ ok: true, data: { locale: "es" } });
    renderProbe();
    await act(async () => screen.getByText("prefetch").click());
    await act(async () => screen.getByText("prefetch").click());
    await act(async () => screen.getByText("switch").click());
    await waitFor(() => expect(screen.getByTestId("current").textContent).toBe("es"));
    expect(loadMessagesAction).toHaveBeenCalledTimes(1);
  });

  it("goes back to the language it was in when the server refuses, and says so", async () => {
    setLocaleAction.mockResolvedValue({ ok: false, code: "RATE_LIMITED", meta: { retryAfter: 60 } });
    renderProbe();
    await act(async () => screen.getByText("switch").click());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByTestId("current").textContent).toBe("en");
    expect(screen.getByTestId("text").textContent).toBe("Translating…");
    expect(document.documentElement.lang).toBe("en");
  });
});
