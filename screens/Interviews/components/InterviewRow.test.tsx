// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { tFor } from "@/lib/i18n/testing";
import type { InterviewListItem } from "@/types/interview";
import type { ListState } from "../utils/listState";
import { InterviewRow } from "./InterviewRow";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const interview: InterviewListItem = {
  id: "i1",
  role: "Backend Engineer",
  status: "COMPLETED",
  createdAt: new Date("2026-11-17T10:00:00.000Z"),
  analysisId: "a1",
  companyName: "Northwind",
  attemptNumber: 2,
  conversationId: "c1",
  hasTranscript: true,
  startCount: 1,
  startedAt: null,
  lastSessionAt: null,
  callAllowedSeconds: null,
  endedAt: null,
  failureReason: null,
  held: true,
  resumableUntil: null,
  lastEnd: "user",
  score: 74,
  secondsLeft: null,
};

const row = (state: ListState, overrides: Partial<InterviewListItem> = {}, locale: "en" | "es" = "en") => {
  const root = document.createElement("ul");
  root.innerHTML = renderToStaticMarkup(
    <InterviewRow interview={{ ...interview, ...overrides }} state={state} n="01" locale={locale} t={tFor("interview", locale)} common={tFor("common", locale)} />,
  );
  return root.querySelector("li") as HTMLLIElement;
};

describe("InterviewRow", () => {
  it("names the role, its company, the date and the attempt, and links the row to its feedback once scored", () => {
    const li = row({ kind: "done", score: 74 });
    expect(li.getAttribute("data-state")).toBe("done");
    const main = li.querySelector("[data-row-link]");
    expect(main?.getAttribute("href")).toBe("/interview/i1/feedback");
    expect(main?.textContent).toBe("Backend Engineer · Scored 74 · Convincing");
    expect(li.textContent).toContain("Northwind");
    expect(li.textContent).toContain("Nov 17, 2026");
    expect(li.textContent).toContain("Attempt 2");
    expect(li.querySelector("time")?.getAttribute("dateTime")).toBe("2026-11-17T10:00:00.000Z");
  });

  it("links to its analysis beside the row's own link, never inside it", () => {
    const li = row({ kind: "done", score: 74 });
    const links = [...li.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/interview/i1/feedback", "/resume/analysis/a1"]);
    expect(links[1].textContent).toBe("The analysis · Backend Engineer, Northwind");
    for (const a of links) expect(a.querySelector("a")).toBeNull();
    expect(row({ kind: "done", score: 74 }, { analysisId: null }).querySelectorAll("a")).toHaveLength(1);
  });

  it("sends a waiting interview to the room, and says what each state is", () => {
    const waiting = { status: "IN_PROGRESS" as const, score: null };
    expect(row({ kind: "ready" }, waiting).querySelector("[data-row-link]")?.getAttribute("href")).toBe("/interview/i1");
    expect(row({ kind: "resumable", early: false, secondsLeft: 284 }, waiting).textContent).toContain("Call dropped · 4:44 left");
    expect(row({ kind: "resumable", early: true, secondsLeft: 123 }, waiting).textContent).toContain("Ended early · 2:03 left");
    expect(row({ kind: "live" }, waiting).textContent).toContain("In progress");
    expect(row({ kind: "saving" }, waiting).textContent).toContain("Saving the call");
    expect(row({ kind: "needsPro" }, waiting).textContent).toContain("Needs Pro to start");
    expect(row({ kind: "pending" }, { status: "FEEDBACK_PENDING", score: null }).textContent).toContain("Preparing feedback");
    expect(row({ kind: "failed" }, { status: "FAILED", score: null }).textContent).toContain("Didn't complete");
    expect(row({ kind: "expired" }, { status: "EXPIRED", score: null }).textContent).toContain("Expired");
  });

  it("marks each state by shape", () => {
    const waiting = { status: "IN_PROGRESS" as const, score: null };
    expect(row({ kind: "ready" }, waiting).querySelector("[data-mark]")?.getAttribute("data-mark")).toBe("empty");
    expect(row({ kind: "resumable", early: false, secondsLeft: 60 }, waiting).querySelector("[data-mark]")?.getAttribute("data-mark")).toBe("half");
    expect(row({ kind: "needsPack" }, waiting).querySelector("[data-mark]")?.getAttribute("data-mark")).toBe("dashed");
    expect(row({ kind: "live" }, waiting).querySelector("[data-mark]")).toBeNull();
  });

  it("reads in Spanish", () => {
    const li = row({ kind: "resumable", early: true, secondsLeft: 123 }, { status: "IN_PROGRESS", score: null }, "es");
    expect(li.textContent).toContain("Terminó antes · quedan 2:03");
    expect(li.textContent).toContain("Intento 2");
    expect(li.textContent).toContain("El análisis");
  });
});
