import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a design-system size next to a design-system colour", () => {
    expect(cn("text-small text-ink-2")).toBe("text-small text-ink-2");
    expect(cn("text-small", "text-h3")).toBe("text-h3");
    expect(cn("text-ink-2", "text-ink")).toBe("text-ink");
    expect(cn("shadow-surface border-line")).toBe("shadow-surface border-line");
  });
});
