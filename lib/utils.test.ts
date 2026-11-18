import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a design-system size next to a design-system colour", () => {
    expect(cn("text-ed-small text-ed-ink-2")).toBe("text-ed-small text-ed-ink-2");
    expect(cn("text-ed-small", "text-ed-h3")).toBe("text-ed-h3");
    expect(cn("text-ed-ink-2", "text-ed-ink")).toBe("text-ed-ink");
    expect(cn("shadow-ed-surface border-ed-line")).toBe("shadow-ed-surface border-ed-line");
  });
});
