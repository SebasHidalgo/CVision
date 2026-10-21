// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEGAL_ENTITY_NAME } from "@/lib/legal";
import PrivacyScreen from "./PrivacyScreen";
import RefundsScreen from "./RefundsScreen";
import TermsScreen from "./TermsScreen";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

describe("the legal drafts", () => {
  it.each([
    ["terms", TermsScreen],
    ["privacy", PrivacyScreen],
    ["refunds", RefundsScreen],
  ])("%s carries the draft banner, the entity placeholder and the links to the other pages", (_, Screen) => {
    const { container } = render(<Screen />);
    expect(screen.getByRole("note").textContent).toMatch(/DRAFT — not legal advice — to be reviewed before launch/);
    expect(container.textContent).toContain(LEGAL_ENTITY_NAME === "LEGAL_ENTITY_NAME" ? "LEGAL_ENTITY_NAME" : LEGAL_ENTITY_NAME);
    for (const href of ["/terms", "/privacy", "/refunds"]) {
      expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    // The merchant of record is named; the wording rule holds here too.
    expect(container.textContent).toMatch(/Paddle/);
    expect(container.textContent).not.toMatch(/screening|hiring decision|coaching|exam preparation/i);
  });
});
