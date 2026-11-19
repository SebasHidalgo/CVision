import { describe, expect, it } from "vitest";
import { legalParts, sectionAnchor, type LegalSection } from "./sections";

const section = (heading: string) => ({ heading, body: [] }) as unknown as LegalSection;

describe("sectionAnchor", () => {
  it("is the section's key, in kebab case: the same in every language", () => {
    expect(sectionAnchor(section("terms.fairUse.heading"))).toBe("fair-use");
    expect(sectionAnchor(section("privacy.collect.heading"))).toBe("collect");
  });
});

describe("legalParts", () => {
  const placeholders = { entity: "LEGAL_ENTITY_NAME", email: "LEGAL_CONTACT_EMAIL" };

  it("marks explicit gaps and the values that are still token names", () => {
    expect(legalParts("LEGAL_ENTITY_NAME, LEGAL_CONTACT_EMAIL. [PLACEHOLDER: registered address.]", placeholders)).toEqual([
      { kind: "placeholder", text: "LEGAL_ENTITY_NAME" },
      { kind: "text", text: ", " },
      { kind: "placeholder", text: "LEGAL_CONTACT_EMAIL" },
      { kind: "text", text: ". " },
      { kind: "placeholder", text: "[PLACEHOLDER: registered address.]" },
    ]);
  });

  it("links a real address and leaves a real name as words", () => {
    expect(legalParts("Ana Pérez, hola@example.com.", { entity: "Ana Pérez", email: "hola@example.com" })).toEqual([
      { kind: "text", text: "Ana Pérez, " },
      { kind: "email", text: "hola@example.com" },
      { kind: "text", text: "." },
    ]);
  });

  it("returns plain text whole, and nothing for nothing", () => {
    expect(legalParts("Nothing to mark.", placeholders)).toEqual([{ kind: "text", text: "Nothing to mark." }]);
    expect(legalParts("", placeholders)).toEqual([]);
  });
});
