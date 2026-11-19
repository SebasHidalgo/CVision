// @vitest-environment jsdom
import { readdirSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Locale, Namespace } from "@/lib/i18n/config";
import { tFor } from "@/lib/i18n/testing";
import RoomLoading from "./(root)/interview/[id]/(room)/loading";
import FeedbackLoading from "./(root)/interview/[id]/feedback/loading";
import InterviewsLoading from "./(root)/interviews/loading";
import AnalysesLoading from "./(root)/resume/analyses/loading";
import AnalysisLoading from "./(root)/resume/analysis/[id]/loading";
import UploadLoading from "./(root)/resume/upload/loading";

const request = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("@/lib/i18n/server", async () => {
  const { tFor: t } = await import("@/lib/i18n/testing");
  return { getT: async (ns: Namespace) => t(ns, request.locale), getLocale: async () => request.locale };
});
vi.mock("@/components/design-system/fonts", () => ({ fontText: { variable: "font-text", style: { fontFamily: "font-text" } } }));

afterEach(() => {
  cleanup();
  request.locale = "en";
});

/** Every loading.tsx under app/, by its folder, with the line its status says. */
const LOADINGS: Record<string, { Loading: () => ReactElement; status: (locale: Locale) => string }> = {
  "resume/upload": { Loading: UploadLoading, status: (l) => tFor("upload", l)("intro.loading") },
  "resume/analyses": { Loading: AnalysesLoading, status: (l) => tFor("analyses", l)("page.loading") },
  "resume/analysis/[id]": { Loading: AnalysisLoading, status: (l) => tFor("analysis", l)("detail.loading") },
  interviews: { Loading: InterviewsLoading, status: (l) => tFor("interview", l)("list.loading") },
  "interview/[id]/(room)": { Loading: RoomLoading, status: (l) => tFor("interview", l)("room.loading") },
  "interview/[id]/feedback": { Loading: FeedbackLoading, status: (l) => tFor("feedback", l)("header.loading") },
};

/** Loading states written alongside these, still to be held to the same checks: move each into LOADINGS. */
const NOT_YET_CHECKED = ["account", "account/billing"];

function loadingFolders(dir: string, at: string[] = []): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return loadingFolders(path.join(dir, entry.name), [...at, entry.name]);
    return entry.name === "loading.tsx" ? [at.filter((part) => part !== "(root)").join("/")] : [];
  });
}

/** A loading.tsx renders one async server component: run it, as Next would, and hand back its tree. */
async function resolve(element: ReactElement): Promise<ReactElement> {
  const inner = element.type as (props: unknown) => Promise<ReactElement>;
  return inner(element.props);
}

describe("the loading states", () => {
  it("never wrap a public page: without JavaScript a streamed page shows only its loading frame", () => {
    for (const page of ["pricing", "terms", "privacy", "refunds"]) expect(loadingFolders(__dirname)).not.toContain(page);
  });

  it("cover every loading.tsx under app/", () => {
    expect(loadingFolders(__dirname).sort()).toEqual([...Object.keys(LOADINGS), ...NOT_YET_CHECKED].sort());
  });

  it.each(Object.entries(LOADINGS))("%s says it is loading in words, in both languages, and nothing else is announced", async (_, { Loading, status }) => {
    for (const locale of ["en", "es"] as const) {
      request.locale = locale;
      const { container, unmount } = render(await resolve(Loading()));
      expect(screen.getByRole("status").textContent).toBe(status(locale));
      expect(status(locale)).not.toBe("");
      // The bones are decoration: hidden from assistive tech, and nothing in a loading state can take focus.
      const bones = container.querySelectorAll("[data-bone]");
      expect(bones.length).toBeGreaterThan(3);
      for (const bone of bones) expect(bone.getAttribute("aria-hidden")).toBe("true");
      expect(container.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
      expect(container.textContent).not.toMatch(/\{\{|\}\}/);
      // On the dark canvas from the first paint: the root carries the design system.
      expect(container.firstElementChild?.classList.contains("root")).toBe(true);
      unmount();
    }
  });
});
