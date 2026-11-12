import "server-only";

import { VoiceKeyRejectedError, VoiceUnavailableError } from "@/lib/error/errors";
import { decideVoiceCapacity, describeVoiceBalance, readBalanceFloor } from "./balance";
import { readVoiceBalance, type VoiceBalanceRead } from "@/lib/voice";

/**
 * The voice health check the session endpoint runs before it reserves
 * anything: is there enough balance on the platform for one more
 * interview? Below the floor the start is refused as VOICE_UNAVAILABLE
 * and the room says so honestly; nothing is reserved, no token is issued,
 * no start is counted. The balance is cached for a minute so a wave of
 * starts does not read it every time. A key without the permission to read
 * it is warned about once and never blocks: the check is a guard, not a
 * dependency.
 */

export const VOICE_BALANCE_CACHE_MS = 60_000;

const LOG = "[CVision][voice]";

type Cached = { at: number; read: VoiceBalanceRead };

let cached: Cached | null = null;
let warnedNoPermission = false;
// A refused key is remembered as long as a good read: a page per second must not ask the platform each time.
let keyRejectedAt: number | null = null;

/** Forgets the cached read and the one-time warning; for tests. */
export function resetVoiceHealth(): void {
  cached = null;
  warnedNoPermission = false;
  keyRejectedAt = null;
}

/** `maxDurationSeconds`: the hard limit of the agent the start would use; the floor is sized on it. */
export async function assertVoiceCapacity(maxDurationSeconds: number, now = Date.now()): Promise<void> {
  const floor = readBalanceFloor(maxDurationSeconds);
  if (floor === 0) return;

  if (keyRejectedAt !== null && now - keyRejectedAt < VOICE_BALANCE_CACHE_MS) throw new VoiceKeyRejectedError("ElevenLabs refused the API key (cached)");

  let read: VoiceBalanceRead;
  let fresh = false;
  if (cached && now - cached.at < VOICE_BALANCE_CACHE_MS) {
    read = cached.read;
  } else {
    try {
      read = await readVoiceBalance();
    } catch (error) {
      // A refused key fails the token call too: say so now, before anything is reserved.
      if (error instanceof VoiceKeyRejectedError) {
        keyRejectedAt = now;
        throw error;
      }
      // The platform did not answer: the token call that follows will say
      // so itself if it is really down. The guard does not add an outage.
      console.warn(`${LOG} balance not read, start not guarded:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
      return;
    }
    cached = { at: now, read };
    keyRejectedAt = null;
    fresh = true;
  }

  if (read.kind === "no-permission") {
    if (!warnedNoPermission) {
      warnedNoPermission = true;
      console.warn(
        `${LOG} the API key lacks ${read.permission}, so the balance cannot be read before a start and starts are not guarded. Grant it at ElevenLabs > Developer > API keys, then restart.`,
      );
    }
    return;
  }

  const capacity = decideVoiceCapacity(read.balance, floor);
  if (capacity.ok) return;

  // One line per fresh read, not per refused start: the owner needs to see
  // it, not to have it repeated by every poll of every room.
  if (fresh) {
    console.error(
      `${LOG} REFUSING voice sessions: ${describeVoiceBalance(read.balance)}; floor ${floor} credits. Add credits or raise the plan at ElevenLabs, or set ${"ELEVENLABS_BALANCE_FLOOR_CREDITS"} if the floor is wrong.`,
    );
  }
  throw new VoiceUnavailableError(`ElevenLabs balance ${capacity.available} is below the floor of ${floor} credits`);
}

/**
 * The same check for a page that only shows what a start would get: "down"
 * when a start would be refused (rejected key, balance under the floor),
 * from the same minute-long cache. Anything else reads as "up": the
 * session endpoint is the authority and says so at Start.
 */
export async function voiceEntryStatus(maxDurationSeconds: number, now = Date.now()): Promise<"up" | "down"> {
  try {
    await assertVoiceCapacity(maxDurationSeconds, now);
    return "up";
  } catch (error) {
    if (error instanceof VoiceKeyRejectedError || error instanceof VoiceUnavailableError) return "down";
    console.warn(`${LOG} voice status not read for the room:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
    return "up";
  }
}
