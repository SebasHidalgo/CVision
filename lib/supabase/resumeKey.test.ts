import { describe, expect, it } from "vitest";
import { buildResumeKey, isResumeKey, isResumeKeyOf } from "./resumeKey";

const USER = "user_33lmzGC7RVwHdO7fMab9Qd6Ing8";

describe("resume keys", () => {
  it("builds a key under the user's prefix with a uuid file name", () => {
    const key = buildResumeKey(USER);

    expect(key.startsWith(`cv/${USER}/`)).toBe(true);
    expect(isResumeKey(key)).toBe(true);
    expect(isResumeKeyOf(key, USER)).toBe(true);
    expect(buildResumeKey(USER)).not.toBe(key);
  });

  it("rejects a key under another user's prefix, however well formed", () => {
    const foreign = buildResumeKey("user_other");

    expect(isResumeKey(foreign)).toBe(true);
    expect(isResumeKeyOf(foreign, USER)).toBe(false);
  });

  it.each([
    ["a path outside cv/", "interview-abc.webm"],
    ["a traversal", `cv/${USER}/../other/x.pdf`],
    ["a nested path", `cv/${USER}/deeper/11111111-2222-4333-8444-555555555555.pdf`],
    ["a non-uuid file name", `cv/${USER}/resume.pdf`],
    ["a non-pdf extension", `cv/${USER}/11111111-2222-4333-8444-555555555555.exe`],
    ["an empty user segment", "cv//11111111-2222-4333-8444-555555555555.pdf"],
    ["a public URL instead of a key", `https://x.supabase.co/storage/v1/object/public/files-bucket/cv/${USER}/11111111-2222-4333-8444-555555555555.pdf`],
  ])("rejects %s", (_, key) => {
    expect(isResumeKey(key)).toBe(false);
    expect(isResumeKeyOf(key, USER)).toBe(false);
  });
});
