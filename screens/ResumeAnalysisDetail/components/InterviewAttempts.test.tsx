import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InterviewAttempt } from "@/types/resume";
import InterviewAttempts from "./InterviewAttempts";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const attempts: InterviewAttempt[] = [
  { id: "i3", status: "IN_PROGRESS", attemptNumber: 3, totalScore: null, createdAt: "2026-10-13T10:00:00.000Z" },
  { id: "i2", status: "COMPLETED", attemptNumber: 2, totalScore: 61, createdAt: "2026-10-12T10:00:00.000Z" },
  { id: "i1", status: "FAILED", attemptNumber: 1, totalScore: null, createdAt: "2026-10-11T10:00:00.000Z" },
];

describe("InterviewAttempts", () => {
  it("lists every attempt in the order given, with its state and score, linking to where it stands", () => {
    const html = renderToStaticMarkup(<InterviewAttempts attempts={attempts} />);

    expect(html.indexOf("Attempt 3")).toBeLessThan(html.indexOf("Attempt 2"));
    expect(html.indexOf("Attempt 2")).toBeLessThan(html.indexOf("Attempt 1"));
    expect(html).toContain('href="/interview/i3"');
    expect(html).toContain("Not finished");
    expect(html).toContain('href="/interview/i2/feedback"');
    expect(html).toContain("Scored 61");
    expect(html).toContain('href="/interview/i1/feedback"');
    expect(html).toContain("Didn&#x27;t complete");
  });

  it("renders nothing for an analysis with no attempts", () => {
    expect(renderToStaticMarkup(<InterviewAttempts attempts={[]} />)).toBe("");
  });
});
