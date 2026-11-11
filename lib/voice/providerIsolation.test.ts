import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The voice provider stays behind the adapter. Nothing outside
 * `lib/voice/elevenlabs/` imports the server SDK, nothing outside the room's
 * `elevenlabs/` folder imports the browser SDK, the app reaches the adapter
 * only through the two facades, and the provider's field names stay inside.
 * A change of provider is then those two folders and the facades' imports.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const SKIP = new Set(["node_modules", ".next", ".git", "docs", "docs.local", "runs", "fixtures.local", ".artifacts"]);
const SOURCE = /\.(ts|tsx|mts)$/;
const SERVER_ADAPTER = "lib/voice/elevenlabs/";
const BROWSER_ADAPTER = "screens/Interview/components/elevenlabs/";

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (SOURCE.test(name)) yield full;
  }
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const files = [...sourceFiles(ROOT)].map((file) => ({ path: relative(file), text: readFileSync(file, "utf8") }));
const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const importing = (pattern: RegExp) => files.filter((file) => pattern.test(file.text)).map((file) => file.path);

describe("voice provider isolation", () => {
  it("only lib/voice/elevenlabs/ imports the ElevenLabs server SDK", () => {
    const outside = importing(/from\s+["']@elevenlabs\/elevenlabs-js["']/).filter((file) => !file.startsWith(SERVER_ADAPTER));
    expect(outside).toEqual([]);
  });

  it("only the room's elevenlabs/ folder imports the ElevenLabs browser SDK", () => {
    const outside = importing(/from\s+["']@elevenlabs\/(react|client)["']/).filter((file) => !file.startsWith(BROWSER_ADAPTER) && !isTest(file));
    expect(outside).toEqual([]);
  });

  it("the app reaches the server adapter only through the facades", () => {
    // The worklet paths are static data the CSP and the browser adapter share; the manual check plays the provider.
    const allowed = new Set(["lib/voice/index.ts", "lib/voice/admin.ts", "lib/securityHeaders.ts", "scripts/eval/m3b-manual-check.ts"]);
    const reaching = [
      ...importing(/from\s+["']@\/lib\/voice\/elevenlabs\//),
      ...importing(/from\s+["']\.\/(voice\/)?elevenlabs\//).filter((file) => file.startsWith("lib/")),
    ]
      .filter((file) => !file.startsWith(SERVER_ADAPTER) && !file.startsWith(BROWSER_ADAPTER))
      .filter((file) => !isTest(file) && !allowed.has(file));
    expect(reaching).toEqual([]);
  });

  it("nothing outside the adapters and the tests names the provider's headers or fields", () => {
    const names =
      /conversation_initiation_client_data|dynamic_variables|call_duration_secs|start_time_unix_secs|termination_reason|elevenlabs-signature|xi-api-key|post_call_transcription|conversationalAi|characterLimit|callDurationSecs/;
    const offenders = files
      .filter((file) => !file.path.startsWith(SERVER_ADAPTER) && !file.path.startsWith(BROWSER_ADAPTER))
      .filter((file) => !isTest(file.path) && file.path !== "scripts/eval/m3b-manual-check.ts")
      .filter((file) => names.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
