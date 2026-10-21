import { beforeEach, describe, expect, it, vi } from "vitest";
import { customDataFor, signUserId, userIdFromCustomData } from "./customData";

const KEY = "pdl_sdbx_apikey_test0000000000000000";

beforeEach(() => {
  vi.stubEnv("PADDLE_ENV", "sandbox");
  vi.stubEnv("PADDLE_API_KEY", KEY);
});

describe("the signed user id in custom data", () => {
  it("round-trips what the server attached", () => {
    const data = customDataFor("user_1");
    expect(data).toEqual({ userId: "user_1", sig: signUserId("user_1", KEY) });
    expect(userIdFromCustomData(data)).toBe("user_1");
  });

  it("ignores an id without a signature, with a signature for another id, or with a signature by another key", () => {
    expect(userIdFromCustomData({ userId: "user_victim" })).toBeNull();
    expect(userIdFromCustomData({ userId: "user_victim", sig: signUserId("user_1", KEY) })).toBeNull();
    expect(userIdFromCustomData({ userId: "user_1", sig: signUserId("user_1", "another key") })).toBeNull();
    expect(userIdFromCustomData({ userId: "user_1", sig: "zz" })).toBeNull();
    expect(userIdFromCustomData(null)).toBeNull();
    expect(userIdFromCustomData({ userId: 42, sig: "x" })).toBeNull();
  });
});
