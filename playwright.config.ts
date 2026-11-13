import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, loadEnv } from "./e2e/support/env";

/**
 * The browser suite (e2e/): real Chromium against the local dev server,
 * the Clerk development instance (test accounts the suite creates and
 * deletes), the Paddle sandbox and, for the opt-in voice spec only, the
 * ElevenLabs workspace. Webhooks reach the server through the tunnel in
 * E2E_PUBLIC_URL, which must be up for the external tier.
 *
 * Three tiers, each once in English and once in Spanish (e2e/run.mjs runs them in this order):
 *   fast       seeded pages; Clerk accounts, no Paddle, no Gemini, no voice, no tunnel
 *   external   the Paddle sandbox and its webhooks through the tunnel (billing, entry)
 *   model      a real Gemini analysis (smoke); alone, because the model-call guard
 *              counts the ledger's rows while a test runs
 *
 *   npm run e2e            all three        npm run e2e:fast / e2e:external
 *   npm run e2e:voice      one real voice start, opt-in: seconds of platform time, cost printed
 *   npm run e2e:cleanup    delete every +clerk_test account left behind
 *
 * Spec files run in parallel workers (E2E_WORKERS, default 4); the tests of a
 * file run in order in one worker, on accounts that file creates. Nothing is
 * shared between files but the server, the sandbox and the tunnel.
 */

loadEnv();

const chrome = devices["Desktop Chrome"];
// Scratch files under e2e/.artifacts (ignored by git) are never part of the suite.
const ARTIFACTS = /[\\/]\.artifacts[\\/]/;
const EXTERNAL = /(billing|entry)\.spec\.ts$/;
const MODEL = /smoke\.spec\.ts$/;
const VOICE = /voice\.spec\.ts$/;

/** The same tier in both interface languages: the specs read their copy from locales/. */
const tier = (name: string, files: { testMatch?: RegExp; testIgnore: RegExp[] }) => [
  { name, use: { ...chrome }, ...files },
  { name: `${name}-es`, use: { ...chrome, locale: "es-ES" }, ...files },
];

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.artifacts/test-results",
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS) || 4,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { outputFolder: process.env.E2E_REPORT_DIR || "e2e/.artifacts/report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    ...tier("fast", { testIgnore: [EXTERNAL, MODEL, VOICE, ARTIFACTS] }),
    ...tier("external", { testMatch: EXTERNAL, testIgnore: [ARTIFACTS] }),
    ...tier("model", { testMatch: MODEL, testIgnore: [ARTIFACTS] }),
    {
      // Fake media devices: the browser grants the microphone and feeds a
      // test tone, so Start reaches the server and the platform with nobody
      // at the keyboard.
      name: "voice",
      use: {
        ...chrome,
        permissions: ["microphone"],
        launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
      },
      testMatch: /voice\.spec\.ts/,
      testIgnore: ARTIFACTS,
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        // Its own production build and server: every Gemini call in the spend ledger, dev tools on.
        command: "node e2e/server.mjs",
        url: "http://localhost:3000/pricing",
        reuseExistingServer: true,
        // It builds first.
        timeout: 600_000,
      },
});
