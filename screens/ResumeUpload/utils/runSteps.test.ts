import { describe, expect, it } from "vitest";
import { clock, runSteps } from "./runSteps";

describe("runSteps", () => {
  it("marks the steps before the current one done, with the time each really took", () => {
    const steps = runSteps("analyzing", { uploading: 1_000, analyzing: 3_400 }, 10_900);
    expect(steps).toEqual([
      { phase: "uploading", state: "done", seconds: 2 },
      { phase: "analyzing", state: "now", seconds: 7 },
      { phase: "opening", state: "next", seconds: null },
    ]);
  });

  it("never reports a negative time when the clock lags the phase change", () => {
    const [upload] = runSteps("uploading", { uploading: 5_000 }, 4_200);
    expect(upload).toEqual({ phase: "uploading", state: "now", seconds: 0 });
  });

  it("leaves a time out when a start was not recorded", () => {
    const steps = runSteps("opening", { analyzing: 0, opening: 9_000 }, 9_500);
    expect(steps.map((s) => s.seconds)).toEqual([null, 9, 0]);
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "now"]);
  });
});

describe("clock", () => {
  it("prints m:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(7.9)).toBe("0:07");
    expect(clock(75)).toBe("1:15");
  });
});
