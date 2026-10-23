import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, loadEnv } from "./e2e/support/env";

/**
 * The browser suite (e2e/): real Chromium against the local dev server,
 * the Clerk development instance (test accounts the suite creates and
 * deletes), the Paddle sandbox and, for the opt-in voice spec only, the
 * ElevenLabs workspace. Webhooks reach the server through the tunnel in
 * E2E_PUBLIC_URL, which must be up for the billing specs.
 *
 *   npm run e2e          the suite (billing, free account, sign-up); no call
 *   npm run e2e:voice    one real voice start, opt-in: it spends seconds of
 *                        platform time and prints the cost
 *   npm run e2e:cleanup  delete every +clerk_test account left behind
 *
 * Everything is read from .env; nothing is hard-coded. One worker: the
 * specs share quotas, the sandbox and the tunnel.
 */

loadEnv();

const chrome = devices["Desktop Chrome"];

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.artifacts/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { outputFolder: "e2e/.artifacts/report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...chrome },
      testIgnore: /voice\.spec\.ts/,
    },
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
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/pricing",
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
