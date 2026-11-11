import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeProvider, reply } from "./client.stub";
import { TRANSLATION_PROMPT_VERSION } from "./prompts/translation.prompt";
import { glossaryFor, glossaryTerms, quotableLabels, readPayload, translateContent, translationSourceHash } from "./translation";

afterEach(() => vi.unstubAllGlobals());

const later = () => Date.now() + 60_000;

describe("glossaryFor", () => {
  it("takes the interface's own labels, so prose and page use the same words", () => {
    const glossary = new Map(glossaryFor("es"));
    expect(glossary.get("Not shown in your CV")).toBe("No aparece en tu CV");
    expect(glossary.get("Partly met")).toBe("Cumplido en parte");
    expect(glossary.get("Preferred")).toBe("Deseable");
    expect(glossary.get("Cultural Fit")).toBe("Afinidad cultural");
    expect(glossary.get("gap")).toBe("brecha");
    expect(glossary.get("education section (of the CV)")).toBe("sección de Formación");
  });
});

describe("quotableLabels", () => {
  it("pairs the interface's labels and the examples the code-made sentences quote", () => {
    const labels = quotableLabels("es");
    expect(labels.get("Not shown in your CV")).toBe("No aparece en tu CV");
    expect(labels.get("Spanish (native), English (C1)")).toBe("Español (nativo), inglés (C1)");
  });
});

describe("translationSourceHash", () => {
  it("is stable under key order and changes with the text, the terms and the prompt version", () => {
    const a = translationSourceHash({ x: "One.", y: "Two." }, "es", ["scalability"], ["Acme"]);
    expect(translationSourceHash({ y: "Two.", x: "One." }, "es", ["scalability"], ["Acme"])).toBe(a);
    expect(translationSourceHash({ x: "One!", y: "Two." }, "es", ["scalability"], ["Acme"])).not.toBe(a);
    expect(translationSourceHash({ x: "One.", y: "Two." }, "es", ["caching"], ["Acme"])).not.toBe(a);
    expect(TRANSLATION_PROMPT_VERSION).toBe("t2");
  });
});

describe("readPayload", () => {
  it("reads the current shape and a plain prose map from before the terms", () => {
    expect(readPayload({ strings: { a: "Uno." }, terms: { caching: "caché" } })).toEqual({ strings: { a: "Uno." }, terms: { caching: "caché" } });
    expect(readPayload({ a: "Uno." })).toEqual({ strings: { a: "Uno." }, terms: {} });
    expect(readPayload(null)).toEqual({ strings: {}, terms: {} });
  });
});

describe("translateContent", () => {
  const sources = {
    "skills.description": "Your CV shows Python and strong software architecture over 3 years.",
    "jobFit.strategicRecommendations.0": "Quantify the 40% drop in incidents.",
  };

  it("sends short ids, the terms first, the glossary; classifies terms and keeps what passes", async () => {
    const provider = installFakeProvider(() =>
      reply.json({
        terms: { t0: { kind: "concept", text: "arquitectura de software" }, t1: { kind: "name", text: "Python" } },
        strings: { s0: "Tu CV muestra Python y una sólida arquitectura de software durante 3 años.", s1: "Cuantifica la baja del 40% en los incidentes." },
      }),
    );
    const result = await translateContent({ sources, locale: "es", terms: ["software architecture", "Python"], sentenceTerms: ["software architecture"], names: [], deadline: later() });
    const request = provider.requests[0];
    expect(request.prompt).toContain('"s0": "Your CV shows Python');
    expect(request.prompt).toContain('"t0": "software architecture"');
    expect(request.prompt).not.toContain("skills.description");
    expect(request.prompt).toContain("Not shown in your CV → No aparece en tu CV");
    expect(request.prompt.indexOf("TERMS (JSON")).toBeLessThan(request.prompt.indexOf("STRINGS (JSON"));
    expect(request.system).toContain("Answer with exactly the ids you were given");
    expect(request.temperature).toBe(0);
    expect(request.seed).toBe(7);
    expect(result.payload).toEqual({
      strings: {
        "skills.description": "Tu CV muestra Python y una sólida arquitectura de software durante 3 años.",
        "jobFit.strategicRecommendations.0": "Cuantifica la baja del 40% en los incidentes.",
      },
      // Only the sentence terms are stored.
      terms: { "software architecture": "arquitectura de software" },
    });
    expect(result.stats).toMatchObject({ strings: 2, kept: 2, calls: 1, retried: 0, fallbacks: 0, terms: { total: 2, names: 1, concepts: 1, forced: 0 } });
  });

  it("forces names it can tell for certain and the company, whatever the model says", async () => {
    installFakeProvider(() =>
      reply.json({
        terms: { t0: { kind: "concept", text: "Nodo.js" }, t1: { kind: "concept", text: "Acme" } },
        strings: { s0: "Usaste Node.js en Acme." },
      }),
    );
    const result = await translateContent({ sources: { a: "You used Node.js at Acme." }, locale: "es", terms: ["Node.js", "Acme"], sentenceTerms: [], names: ["Acme"], deadline: later() });
    expect(result.decisions.map((d) => [d.term, d.kind, d.text, d.forced])).toEqual([
      ["Node.js", "name", "Node.js", true],
      ["Acme", "name", "Acme", true],
    ]);
  });

  it("makes a glossary entry a concept with the glossary's words, however the model classed it", async () => {
    expect(glossaryTerms("es").get("applicant tracking system")).toBe("sistema de seguimiento de postulaciones (ATS)");
    expect(glossaryTerms("es").get("resume")).toBe("CV");
    installFakeProvider(() =>
      reply.json({
        terms: { t0: { kind: "name", text: "Applicant Tracking System" } },
        strings: { s0: "Tu CV pasa por cualquier sistema de seguimiento de postulaciones (ATS)." },
      }),
    );
    const result = await translateContent({ sources: { a: "Your CV passes any Applicant Tracking System." }, locale: "es", terms: ["Applicant Tracking System"], sentenceTerms: [], names: [], deadline: later() });
    expect(result.decisions).toEqual([{ term: "Applicant Tracking System", kind: "concept", text: "sistema de seguimiento de postulaciones (ATS)", forced: true }]);
    expect(result.stats.fallbacks).toBe(0);
  });

  it("retries a failing string telling the model what it broke, and keeps the fix", async () => {
    let call = 0;
    const provider = installFakeProvider(() => {
      call += 1;
      if (call === 1) {
        return reply.json({
          terms: { t0: { kind: "name", text: "Python" } },
          strings: { s0: "Tu CV muestra Pitón y una sólida arquitectura de software durante 3 años.", s1: "Cuantifica la baja del 40% en los incidentes." },
        });
      }
      return reply.json({ strings: { s0: "Tu CV muestra Python y una sólida arquitectura de software durante 3 años." } });
    });
    const result = await translateContent({ sources, locale: "es", terms: ["Python"], sentenceTerms: [], names: [], deadline: later() });
    expect(provider.requests).toHaveLength(2);
    const retry = provider.requests[1].prompt;
    expect(retry).toContain('s0: copy these names exactly as written: "Python"');
    expect(retry).toContain("your previous answer:");
    expect(retry).toContain("TERMS ALREADY DECIDED");
    expect(retry).not.toContain('"s1"');
    expect(result.stats).toMatchObject({ kept: 2, calls: 2, retried: 1, fallbacks: 0, counts: { name: 1 }, remaining: {} });
  });

  it("falls back to English only after two retries still break a hard check", async () => {
    const provider = installFakeProvider(() => reply.json({ strings: { s0: "Cuantifica la baja del 50% en los incidentes." } }));
    const result = await translateContent({ sources: { a: "Quantify the 40% drop in incidents." }, locale: "es", terms: [], sentenceTerms: [], names: [], deadline: later() });
    expect(provider.requests).toHaveLength(3);
    expect(result.payload.strings).toEqual({});
    expect(result.stats).toMatchObject({ fallbacks: 1, remaining: { digits: 1 } });
    expect(result.fallbacks).toEqual([{ path: "a", checks: ["digits"] }]);
  });

  it("keeps a translation that still breaks only a soft check after the retries", async () => {
    installFakeProvider(() => reply.json({ terms: { t0: { kind: "concept", text: "escalabilidad" } }, strings: { s0: "Tu CV muestra scalability en tus proyectos." } }));
    const result = await translateContent({ sources: { a: "Your CV shows scalability in your projects." }, locale: "es", terms: ["scalability"], sentenceTerms: [], names: [], deadline: later() });
    expect(result.payload.strings).toEqual({ a: "Tu CV muestra scalability en tus proyectos." });
    expect(result.stats).toMatchObject({ fallbacks: 0, remaining: { "english-term": 1 } });
  });

  it("retries a concept left in English together with the strings that use it", async () => {
    let call = 0;
    const provider = installFakeProvider(() => {
      call += 1;
      if (call === 1) return reply.json({ terms: { t0: { kind: "concept", text: "Computer Science" } }, strings: { s0: "Tienes un título en Computer Science." } });
      return reply.json({ terms: { t0: { kind: "concept", text: "informática" } }, strings: { s0: "Tienes un título en informática." } });
    });
    const result = await translateContent({ sources: { a: "Holds a degree in Computer Science." }, locale: "es", terms: ["Computer Science"], sentenceTerms: ["Computer Science"], names: [], deadline: later() });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].prompt).toContain('"t0": "Computer Science"');
    expect(result.payload).toEqual({ strings: { a: "Tienes un título en informática." }, terms: { "Computer Science": "informática" } });
  });

  it("skips retries when the deadline leaves no room", async () => {
    const provider = installFakeProvider(() => reply.json({ strings: { s0: "Cuantifica la baja del 50% en los incidentes." } }));
    const result = await translateContent({ sources: { a: "Quantify the 40% drop in incidents." }, locale: "es", terms: [], sentenceTerms: [], names: [], deadline: Date.now() + 2_500 });
    expect(provider.requests).toHaveLength(1);
    expect(result.stats.fallbacks).toBe(1);
  });

  it("throws the client's error when the first answer leaves out an id", async () => {
    installFakeProvider(() => reply.json({ strings: { s0: "Una." } }));
    await expect(
      translateContent({ sources: { a: "One sentence here.", b: "Another sentence here." }, locale: "es", terms: [], sentenceTerms: [], names: [], deadline: later() }),
    ).rejects.toMatchObject({ code: "AI_BAD_FORMAT" });
  });
});
