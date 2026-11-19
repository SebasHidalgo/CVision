import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANSWERED_GAPS, REQUIREMENTS } from "@/screens/Home/utils/exampleCase";
import { LOCALES } from "@/lib/i18n/config";
import { answerLineAt, EXAMPLE_REPORT } from "./exampleReport";
import { TURN_HOLD_MS } from "@/components/interview/room/turn";
import { audioSrc, callTimeAt, clock, lineAt, REPLY_GAP, TALK_GAP, TALK_LINE_IDS, TALK_LINES, timelineFor, turnAt, turnEventsFor, voiceAt } from "./talk";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
type Tree = Record<string, unknown>;
const read = (locale: string, ns: string): Tree => JSON.parse(readFileSync(path.join(ROOT, "locales", locale, `${ns}.json`), "utf8"));
const get = (tree: Tree, dotted: string): unknown => dotted.split(".").reduce<unknown>((at, key) => (at as Tree | undefined)?.[key], tree);

function leaves(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const at = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[at, value] as [string, string]] : leaves(value as Tree, at);
  });
}

describe("the example conversation", () => {
  it("alternates interviewer and candidate, in call order, with every locale's audio length", () => {
    expect(TALK_LINES.map((l) => l.id)).toEqual([...TALK_LINE_IDS]);
    TALK_LINES.forEach((l, i) => {
      expect(l.who).toBe(i % 2 === 0 ? "e" : "c");
      if (i > 0) expect(l.at).toBeGreaterThan(TALK_LINES[i - 1].at);
      for (const locale of LOCALES) expect(l.seconds[locale]).toBeGreaterThan(1);
    });
  });

  it.each(LOCALES)("%s: plays each line after the last one ends, and the call clock never runs backwards", (locale) => {
    const timeline = timelineFor(locale);
    timeline.lines.forEach((l, i) => {
      if (i > 0) expect(l.start).toBeGreaterThan(timeline.lines[i - 1].start + timeline.lines[i - 1].seconds);
      expect(lineAt(timeline, l.start)).toBe(i);
    });
    expect(lineAt(timeline, 0)).toBe(-1);
    let previous = -1;
    for (let t = 0; t <= timeline.end; t += 0.1) {
      const call = callTimeAt(timeline, t);
      expect(call).toBeGreaterThanOrEqual(previous);
      previous = call;
    }
    expect(audioSrc(locale, 0)).toBe(`/landing/voice/${locale}/01.mp3`);
  });

  it("formats call times as the app's transcript does", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(81)).toBe("1:21");
    expect(clock(720)).toBe("12:00");
    expect(clock(-3)).toBe("0:00");
  });

  it("answers the case's open requirements where the case says they were answered", () => {
    for (const gap of ANSWERED_GAPS) {
      const line = answerLineAt(gap.at);
      expect(line, gap.req).toBeGreaterThanOrEqual(0);
      expect(REQUIREMENTS.find((r) => r.id === gap.req)?.status).not.toBe("met");
    }
    expect(EXAMPLE_REPORT.gaps.map((g) => g.line)).toEqual(ANSWERED_GAPS.map((g) => answerLineAt(g.at)));
    // Every point the report makes rests on something the candidate said.
    for (const p of [...EXAMPLE_REPORT.answers, ...EXAMPLE_REPORT.worked, ...EXAMPLE_REPORT.workOn]) expect(TALK_LINES[p.line].who).toBe("c");
  });
});

describe("the section's copy", () => {
  it.each(LOCALES)("%s: the replicas use the app's own words for every label they copy", (locale) => {
    const mine = read(locale, "landingInterview");
    // The room is the app's own component (components/interview/room): it reads the interview namespace, copies nothing.
    expect(get(mine, "app.interview")).toBeUndefined();
    // A replica that renders the app's own component reads the app's namespace and copies nothing.
    for (const source of (["interview", "feedback"] as const).filter((ns) => get(mine, `app.${ns}`) !== undefined)) {
      const copied = leaves(get(mine, `app.${source}`) as Tree);
      expect(copied.length).toBeGreaterThan(10);
      const app = read(locale, source);
      expect(copied.filter(([key, value]) => get(app, key) !== value).map(([key]) => `${source}.${key}`)).toEqual([]);
    }
  });

  it.each(LOCALES)("%s: the report quotes the answers exactly as the conversation says them", (locale) => {
    const lines = get(read(locale, "landingInterview"), "talk.lines") as Tree;
    const answers = get(read(locale, "landing"), "case.answers") as Tree;
    for (const gap of ANSWERED_GAPS) expect(answers[gap.req], gap.req).toBe(lines[TALK_LINES[answerLineAt(gap.at)].id]);
  });

  it.each(LOCALES)("%s: a line for every talk id, and nothing that isn't one", (locale) => {
    const lines = get(read(locale, "landingInterview"), "talk.lines") as Tree;
    expect(Object.keys(lines)).toEqual([...TALK_LINE_IDS]);
  });
});

describe("the excerpt's turn, by the app's rule", () => {
  it.each(LOCALES)("%s: never says 'your turn' while the interviewer speaks, gives the answer its turn, and lets the interviewer compose after it", (locale) => {
    const timeline = timelineFor(locale);
    const events = turnEventsFor(timeline);
    for (let t = 0; t <= timeline.end; t += 0.05) {
      const voice = voiceAt(timeline, t);
      const turn = turnAt(events, t);
      if (voice === "e") expect(turn, `${locale} at ${t.toFixed(2)} s`).toBe("interviewer");
      if (voice === "c") expect(turn, `${locale} at ${t.toFixed(2)} s`).toBe("candidate");
    }
    timeline.lines.forEach((line, i) => {
      const next = timeline.lines[i + 1];
      if (!next) return;
      const gap = (from: number) => turnAt(events, line.start + line.seconds + from);
      // Between a question and its answer the turn is the interviewer's until the candidate is heard (the gap is shorter than the hold).
      if (line.who === "e") expect(gap(TALK_GAP / 2)).toBe("interviewer");
      // After an answer, the interviewer takes its beat: its turn, in silence.
      else expect(gap(REPLY_GAP / 2)).toBe("waiting");
    });
    expect(TALK_GAP * 1000).toBeLessThan(TURN_HOLD_MS);
  });

  it("opens on the interviewer's turn, before its first word", () => {
    const timeline = timelineFor("en");
    expect(turnAt(turnEventsFor(timeline), timeline.lines[0].start / 2)).toBe("waiting");
  });
});
