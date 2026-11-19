import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MIN_PEPPER_CHARS, normalizeEmail, readTrialPepper, trialClaimHash, trialIdentityOf, verifiedAddresses } from "./trialClaim";

const PEPPER = "p".repeat(MIN_PEPPER_CHARS);

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Ana.Perez@Example.COM \n")).toBe("ana.perez@example.com");
  });

  it("cuts a +tag on every domain, also several and an empty one", () => {
    expect(normalizeEmail("ana+jobs@example.com")).toBe("ana@example.com");
    expect(normalizeEmail("ana+a+b@outlook.com")).toBe("ana@outlook.com");
    expect(normalizeEmail("ana+@proton.me")).toBe("ana@proton.me");
    expect(normalizeEmail("e2e-trial-1-ab+algo+clerk_test@example.com")).toBe("e2e-trial-1-ab@example.com");
  });

  it("on Gmail removes the dots of the local part and reads googlemail.com as gmail.com", () => {
    expect(normalizeEmail("a.n.a.perez@gmail.com")).toBe("anaperez@gmail.com");
    expect(normalizeEmail("Ana.Perez+cv@GoogleMail.com")).toBe("anaperez@gmail.com");
    expect(normalizeEmail("anaperez@gmail.com.")).toBe("anaperez@gmail.com");
  });

  it("keeps dots everywhere else", () => {
    expect(normalizeEmail("ana.perez@outlook.com")).toBe("ana.perez@outlook.com");
    expect(normalizeEmail("ana.perez@gmail.co")).toBe("ana.perez@gmail.co");
  });

  it("cuts a -tag on Yahoo's domains (yahoo.<tld>, regional ones, ymail, rocketmail)", () => {
    expect(normalizeEmail("ana-jobs@yahoo.com")).toBe("ana@yahoo.com");
    expect(normalizeEmail("ana-jobs@yahoo.co.uk")).toBe("ana@yahoo.co.uk");
    expect(normalizeEmail("ana-x-y@yahoo.com.ar")).toBe("ana@yahoo.com.ar");
    expect(normalizeEmail("ana-1@ymail.com")).toBe("ana@ymail.com");
    expect(normalizeEmail("ana-1@rocketmail.com")).toBe("ana@rocketmail.com");
    expect(normalizeEmail("ana-1+z@yahoo.es")).toBe("ana@yahoo.es");
  });

  it("keeps a hyphen anywhere else, also on look-alike domains", () => {
    expect(normalizeEmail("ana-maria@example.com")).toBe("ana-maria@example.com");
    expect(normalizeEmail("ana-maria@gmail.com")).toBe("ana-maria@gmail.com");
    expect(normalizeEmail("ana-maria@notyahoo.com")).toBe("ana-maria@notyahoo.com");
    expect(normalizeEmail("ana-maria@yahoo-mail.com")).toBe("ana-maria@yahoo-mail.com");
  });

  it("refuses what is not one address", () => {
    for (const bad of ["", "   ", "ana", "@example.com", "ana@", "ana@@example.com", "a@b@example.com", "ana @example.com", "ana@localhost", "ana@example..com", "ana@.example.com", "+tag@example.com", "...@gmail.com", "-x@yahoo.com"]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});

describe("trialClaimHash", () => {
  it("is the hex HMAC-SHA256 of the normalized email keyed with the pepper", () => {
    expect(trialClaimHash("ana@example.com", PEPPER)).toBe(createHmac("sha256", PEPPER).update("ana@example.com").digest("hex"));
    expect(trialClaimHash("ana@example.com", PEPPER)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the pepper: a rotated pepper forgets every claim", () => {
    expect(trialClaimHash("ana@example.com", PEPPER)).not.toBe(trialClaimHash("ana@example.com", "q".repeat(MIN_PEPPER_CHARS)));
  });
});

describe("readTrialPepper", () => {
  it("reads it trimmed, and treats missing, blank or short as missing", () => {
    expect(readTrialPepper({ TRIAL_CLAIM_PEPPER: ` ${PEPPER} ` })).toBe(PEPPER);
    expect(readTrialPepper({})).toBeNull();
    expect(readTrialPepper({ TRIAL_CLAIM_PEPPER: "   " })).toBeNull();
    expect(readTrialPepper({ TRIAL_CLAIM_PEPPER: "x".repeat(MIN_PEPPER_CHARS - 1) })).toBeNull();
  });
});

describe("verifiedAddresses", () => {
  it("keeps only the addresses Clerk marks verified", () => {
    expect(
      verifiedAddresses([
        { emailAddress: "a@example.com", verification: { status: "verified" } },
        { emailAddress: "b@example.com", verification: { status: "unverified" } },
        { emailAddress: "c@example.com", verification: null },
        { emailAddress: "d@example.com", verification: { status: "expired" } },
      ]),
    ).toEqual(["a@example.com"]);
  });
});

describe("trialIdentityOf", () => {
  it("hashes every distinct inbox, sorted: the variants of one inbox are one claim", () => {
    const identity = trialIdentityOf(["Ana.Perez@gmail.com", "anaperez+x@googlemail.com", "ana@work.example"], PEPPER);
    expect(identity).toEqual({
      kind: "emails",
      hashes: [trialClaimHash("anaperez@gmail.com", PEPPER), trialClaimHash("ana@work.example", PEPPER)].sort(),
    });
  });

  it("fails closed without a pepper, and with no usable verified address", () => {
    expect(trialIdentityOf(["ana@example.com"], null)).toEqual({ kind: "unavailable", cause: "no-pepper" });
    expect(trialIdentityOf([], PEPPER)).toEqual({ kind: "unavailable", cause: "no-verified-email" });
    expect(trialIdentityOf(["not an email"], PEPPER)).toEqual({ kind: "unavailable", cause: "no-verified-email" });
  });
});
