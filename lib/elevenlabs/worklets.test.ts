import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIBSAMPLERATE_WORKLET_URL, WORKLET_PATHS } from "./worklets";

const ROOT = path.resolve(__dirname, "..", "..");
const SDK_WORKLETS = path.join(ROOT, "node_modules", "@elevenlabs", "client", "worklets");

/** Line endings aside: a checkout with core.autocrlf rewrites the copies to CRLF, the SDK ships LF, the browser does not care. */
const lf = (text: string) => text.replace(/\r\n/g, "\n");

/**
 * The worklets served from public/ are copies of the installed SDK's: an
 * SDK upgrade that changes them fails here until the copies are refreshed
 * (copy `node_modules/@elevenlabs/client/worklets/*.js` over
 * `public/worklets/`). The resampler URL the policy allows must be the one
 * the SDK bundle names.
 */
describe("the self-hosted audio worklets", () => {
  it.each(Object.entries(WORKLET_PATHS))("%s is served from public and matches the SDK's file", (_name, publicPath) => {
    const served = readFileSync(path.join(ROOT, "public", publicPath), "utf8");
    const shipped = readFileSync(path.join(SDK_WORKLETS, path.basename(publicPath)), "utf8");
    expect(lf(served)).toBe(lf(shipped));
    expect(served).toMatch(/registerProcessor\(/);
  });

  it("allows exactly the resampler URL the installed SDK loads", () => {
    const bundle = readFileSync(path.join(ROOT, "node_modules", "@elevenlabs", "client", "dist", "lib.iife.js"), "utf8");
    expect(bundle).toContain(`"${LIBSAMPLERATE_WORKLET_URL}"`);
  });
});
