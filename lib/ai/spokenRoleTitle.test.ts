import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateJsonReported } from "@/lib/ai/client";
import { checkSpokenTitle, spokenTitleHash, translateSpokenTitle } from "./spokenRoleTitle";

vi.mock("@/lib/ai/client", () => ({ generateJsonReported: vi.fn() }));

const answer = (title: string) => ({ value: { title }, model: "gemini-test", modelVersion: "v1", input: 120, output: 8 });

describe("checkSpokenTitle", () => {
  it("passes an ordinary translation", () => {
    expect(checkSpokenTitle("Desarrollador Junior", "Junior Developer", "Northwind")).toEqual([]);
    expect(checkSpokenTitle("Senior Backend Engineer", "Ingeniero Backend Senior", "Northwind")).toEqual([]);
  });

  it("keeps technology names, acronyms and numbers as written", () => {
    expect(checkSpokenTitle("Desarrollador .NET con React", "React .NET Developer", "Acme")).toEqual([]);
    expect(checkSpokenTitle("Analista QA", "Quality Analyst", "Acme")).toEqual(["name"]);
    expect(checkSpokenTitle("Ingeniero de Datos Nivel 2", "Data Engineer Level II", "Acme")).toContain("digits");
    expect(checkSpokenTitle("Desarrollador TypeScript", "Typescript Developer", "Acme")).toEqual(["name"]);
  });

  it("accepts AI said as IA and IT as TI", () => {
    expect(checkSpokenTitle("AI Engineer", "Ingeniero de IA", "Acme")).toEqual([]);
    expect(checkSpokenTitle("Soporte TI", "IT Support", "Acme")).toEqual([]);
  });

  it("refuses an empty answer, a sentence instead of a title, and the company added", () => {
    expect(checkSpokenTitle("Desarrollador Junior", "  ", "Northwind")).toEqual(["empty"]);
    expect(checkSpokenTitle("QA", "The quality assurance engineer position in the payments team of the company", "Acme")).toContain("length");
    expect(checkSpokenTitle("Desarrollador Junior", "Junior Developer at Northwind", "Northwind")).toEqual(["company"]);
  });
});

describe("translateSpokenTitle", () => {
  beforeEach(() => vi.mocked(generateJsonReported).mockReset());

  it("returns the first answer that passes", async () => {
    vi.mocked(generateJsonReported).mockResolvedValueOnce(answer("Junior Developer"));
    const result = await translateSpokenTitle({ title: "Desarrollador Junior", company: "Northwind", from: "es", to: "en", deadline: Date.now() + 10_000 });
    expect(result).toMatchObject({ text: "Junior Developer", attempts: 1, checks: [], model: "gemini-test" });
  });

  it("retries once with what the answer broke, then keeps the posting's title", async () => {
    vi.mocked(generateJsonReported).mockResolvedValueOnce(answer("Quality Analyst")).mockResolvedValueOnce(answer("Quality Analyst"));
    const result = await translateSpokenTitle({ title: "Analista QA", company: "Acme", from: "es", to: "en", deadline: Date.now() + 20_000 });
    expect(result).toMatchObject({ text: null, attempts: 2, checks: ["name"] });
    const retry = vi.mocked(generateJsonReported).mock.calls[1][0] as { prompt: string };
    expect(retry.prompt).toContain("Your previous answer was: Quality Analyst");
    expect(retry.prompt).toContain("acronyms must stay exactly as written");
  });

  it("throws the first call's error for the caller to log", async () => {
    vi.mocked(generateJsonReported).mockRejectedValueOnce(Object.assign(new Error("down"), { code: "AI_UNAVAILABLE" }));
    await expect(translateSpokenTitle({ title: "Desarrollador", company: "Acme", from: "es", to: "en", deadline: Date.now() + 10_000 })).rejects.toThrow("down");
  });

  it("hashes the title and both languages", () => {
    expect(spokenTitleHash("Desarrollador", "es", "en")).not.toBe(spokenTitleHash("Desarrollador", "en", "es"));
    expect(spokenTitleHash("Desarrollador", "es", "en")).toBe(spokenTitleHash("Desarrollador", "es", "en"));
  });
});
