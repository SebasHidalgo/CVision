/**
 * One Spanish greeting in each candidate voice, saved as MP3 files, so the
 * owner can choose the interviewer's Spanish voice by ear: the current
 * voice on the multilingual model and two native Latin American ones from
 * the ElevenLabs library.
 *
 *   npm run voice:samples -- --out ./voice-samples
 *
 * Spends about 190 characters per voice. Needs text_to_speech on the key
 * (the platform names the permission when it is missing). The chosen id
 * goes in INTERVIEW_AGENT_PRESET_VOICE_IDS (lib/voice/elevenlabs/agentConfig.ts),
 * then npm run agent:sync. Never prints the key.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SPANISH_VOICE_CANDIDATES, SPANISH_VOICE_SAMPLE_TEXT, synthesizeVoiceSample } from "@/lib/voice/admin";

const { values: args } = parseArgs({ options: { out: { type: "string" } } });

async function main() {
  const out = path.resolve(args.out ?? "voice-samples");
  mkdirSync(out, { recursive: true });
  console.log(`Line (${SPANISH_VOICE_SAMPLE_TEXT.length} characters): ${SPANISH_VOICE_SAMPLE_TEXT}`);
  for (const [index, voice] of SPANISH_VOICE_CANDIDATES.entries()) {
    const file = path.join(out, `${index + 1}-${voice.slug}.mp3`);
    const audio = await synthesizeVoiceSample(voice.id);
    writeFileSync(file, audio);
    console.log(`${file}  ${voice.name} (${voice.id})`);
  }
  console.log("\nListen, choose one, and set its id for \"es\" in INTERVIEW_AGENT_PRESET_VOICE_IDS; then npm run agent:sync.");
}

// The script smoke test (scripts/scripts.test.ts) loads this module under the
// npm script's own flags to prove its import graph resolves; it must not run.
if (process.env.CVISION_SCRIPT_SMOKE !== "1") {
  main().catch((error: unknown) => {
    console.error(`voice:samples failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
