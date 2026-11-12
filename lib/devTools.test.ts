import { describe, expect, it } from "vitest";
import { devToolsAllowed } from "./devTools";

describe("devToolsAllowed", () => {
  it("needs the explicit flag and the sandbox, and never runs on production", () => {
    expect(devToolsAllowed({ ALLOW_DEV_TOOLS: "1", PADDLE_ENV: "sandbox" })).toBe(true);
    expect(devToolsAllowed({ PADDLE_ENV: "sandbox" })).toBe(false);
    expect(devToolsAllowed({ ALLOW_DEV_TOOLS: "1", PADDLE_ENV: "production" })).toBe(false);
    expect(devToolsAllowed({ ALLOW_DEV_TOOLS: "1" })).toBe(false);
    expect(devToolsAllowed({ ALLOW_DEV_TOOLS: "true", PADDLE_ENV: "sandbox" })).toBe(false);
    expect(devToolsAllowed({ ALLOW_DEV_TOOLS: "1", PADDLE_ENV: "sandbox", VERCEL_ENV: "production" })).toBe(false);
  });
});
