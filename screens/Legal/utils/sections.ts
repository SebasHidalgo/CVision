import type { ParseKeys } from "i18next";

export type LegalKey = ParseKeys<"legal">;

export type LegalSection = {
  heading: LegalKey;
  /** Paragraphs, or a bulleted list when given an array. */
  body: readonly (LegalKey | readonly LegalKey[])[];
};

/**
 * A section's anchor: its key on the page ("terms.fairUse.heading" → "fair-use"). The same in every language and
 * stable while the section keeps its key, so a link to /terms#fair-use keeps working when the wording changes.
 */
export function sectionAnchor(section: LegalSection): string {
  const name = section.heading.split(".")[1] ?? section.heading;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** One run of a legal paragraph: plain words, a gap the owner still has to fill, or the contact address. */
export type LegalPart = { kind: "text" | "placeholder" | "email"; text: string };

/** What a draft still lacks: an explicit "[PLACEHOLDER: …]" note, or a value that is still its own token name. */
const PLACEHOLDER = /\[PLACEHOLDER:[^\]]*\]/g;
const TOKEN = /^[A-Z][A-Z0-9_]+$/;
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Splits a rendered paragraph so the page can mark the draft's gaps and link the contact address. `values` are the
 * interpolated values that may appear in the text: one that is still a token ("LEGAL_ENTITY_NAME") is a gap, a real
 * address is a mailto link.
 */
export function legalParts(text: string, values: { entity: string; email: string }): LegalPart[] {
  const tokens = [values.entity, values.email].filter((value) => TOKEN.test(value));
  const address = ADDRESS.test(values.email) ? values.email : null;
  const pieces = [PLACEHOLDER.source, ...tokens.map(escape), ...(address ? [escape(address)] : [])];
  const pattern = new RegExp(pieces.join("|"), "g");

  const parts: LegalPart[] = [];
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > at) parts.push({ kind: "text", text: text.slice(at, start) });
    parts.push({ kind: match[0] === address ? "email" : "placeholder", text: match[0] });
    at = start + match[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}
