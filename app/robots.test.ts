import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots.txt", () => {
  it("allows the public pages and disallows the API and every page behind sign-in", () => {
    const { rules } = robots();
    expect(rules).toEqual({
      userAgent: "*",
      allow: ["/", "/pricing", "/terms", "/privacy", "/refunds"],
      disallow: ["/api/", "/account/", "/dev/", "/interview/", "/interviews", "/resume/"],
    });
  });

  it("names no sitemap or host: none exists", () => {
    const result = robots();
    expect(result.sitemap).toBeUndefined();
    expect(result.host).toBeUndefined();
  });
});
