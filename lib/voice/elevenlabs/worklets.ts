/**
 * The browser SDK's AudioWorklet processors, served from this origin. By
 * default `@elevenlabs/client` loads them from `blob:` and `data:` URLs
 * built at runtime, which the Content-Security-Policy's `script-src`
 * refuses (seen in the browser suite: "Failed to set up audio capture"),
 * so the two files the voice call needs are copied from
 * `@elevenlabs/client/worklets/` into `public/worklets/` and the room
 * points the SDK at them (`workletPaths` in `startSession`).
 * `worklets.test.ts` fails when the copies drift from the installed SDK.
 *
 * The sample-rate converter the SDK loads only in browsers that cannot
 * open the microphone at the requested rate stays on its CDN, allowed by
 * its exact URL; two megabytes of WebAssembly are not worth vendoring for
 * a path Chromium never takes. Import-free: the room is a client component.
 */

export const WORKLET_PATHS = {
  rawAudioProcessor: "/worklets/rawAudioProcessor.js",
  audioConcatProcessor: "/worklets/audioConcatProcessor.js",
} as const;

/** The resampler worklet the SDK fetches itself, pinned to the version the installed SDK names. */
export const LIBSAMPLERATE_WORKLET_URL = "https://cdn.jsdelivr.net/npm/@alexanderolsen/libsamplerate-js@2.1.2/dist/libsamplerate.worklet.js";
