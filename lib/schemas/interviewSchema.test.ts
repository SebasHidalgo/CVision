import { describe, expect, it } from "vitest";
import { techstackSchema } from "./interviewSchema";

describe("techstackSchema", () => {
  const accepts = (value: unknown) => techstackSchema.safeParse(value).success;

  it("accepts up to 30 entries of 1-60 characters", () => {
    expect(accepts(Array(30).fill("TypeScript"))).toBe(true);
    expect(accepts(["x".repeat(60)])).toBe(true);
    expect(accepts([])).toBe(true);
  });

  it("rejects more than 30 entries", () => {
    expect(accepts(Array(31).fill("TypeScript"))).toBe(false);
  });

  it("rejects empty and over-long entries", () => {
    expect(accepts([""])).toBe(false);
    expect(accepts(["x".repeat(61)])).toBe(false);
  });
});
