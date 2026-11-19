// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

// The design system's face comes from next/font, which only runs under Next.
vi.mock("next/font/google", () => ({ Host_Grotesk: () => ({ variable: "font-text" }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({ note }: { note?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete it?"
        body="Everything goes."
        note={note}
        confirmLabel="Delete"
        cancelLabel="Keep"
        pendingLabel="Deleting…"
        pending={false}
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}

/** Renders the harness, opens the dialog from its button (focused first, as a click would). */
function openDialog(note?: string) {
  render(<Harness note={note} />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: screen.getByRole("alertdialog") };
}

describe("ConfirmDialog", () => {
  it("stays inside the viewport: only the body scrolls, the title and the actions never shrink", () => {
    const { dialog } = openDialog();
    expect(dialog.className).toMatch(/\bmax-h-\[calc\(100dvh-32px\)\]/);
    expect(dialog.className).toMatch(/\bflex-col\b/);
    const body = dialog.querySelector("[data-confirm-body]");
    expect(body?.className).toMatch(/\bmin-h-0\b/);
    expect(body?.className).toMatch(/\boverflow-y-auto\b/);
    expect(dialog.querySelector("[data-confirm-actions]")?.className).toMatch(/\bflex-none\b/);
    expect(screen.getByRole("heading", { name: "Delete it?" }).className).toMatch(/\bflex-none\b/);
  });

  it("reads the body and the note as the dialog's description", () => {
    expect(openDialog().dialog.querySelector("[data-confirm-note]")).toBeNull();
    cleanup();
    const { dialog } = openDialog("You lose the rest of the period.");
    const description = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe("Everything goes.You lose the rest of the period.");
    expect(dialog.querySelector("[data-confirm-note]")?.textContent).toBe("You lose the rest of the period.");
  });

  it("makes the body a tab stop only when it scrolls", () => {
    let overflowing = false;
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => (overflowing ? 900 : 100));
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 100);

    expect(openDialog().dialog.querySelector("[data-confirm-body]")?.hasAttribute("tabindex")).toBe(false);
    cleanup();

    overflowing = true;
    expect(openDialog().dialog.querySelector("[data-confirm-body]")?.getAttribute("tabindex")).toBe("0");
  });

  it("focuses Keep first and gives focus back to the opener on Escape", async () => {
    const { opener } = openDialog();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Keep"));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
