import "server-only";

import { createClient } from "@supabase/supabase-js";
import { StorageMisconfiguredError, StorageUnavailableError } from "@/lib/error/errors";
import { MAX_RESUME_BYTES } from "@/lib/uploadLimits";

/**
 * The only module that talks to Supabase Storage. It holds the service role,
 * which bypasses the bucket's row-level policies, so nothing here trusts a
 * key it was handed: callers check ownership (`isResumeKeyOf`) before asking
 * for anything. The browser never sees this client or any Supabase key; it
 * gets short-lived signed URLs minted here.
 */

export const RESUME_BUCKET = "files-bucket";

/** How long a signed read URL for the CV drawer stays valid. */
export const SIGNED_READ_TTL_SECONDS = 10 * 60;

/** Every storage call, including a download of the largest allowed CV. */
export const STORAGE_TIMEOUT_MS = 10_000;

/**
 * What the bucket should be. `scripts/storage/bucket-private.ts` applies it;
 * the dashboard mirrors the code. Private: reads go through signed URLs and
 * uploads through signed upload URLs, both minted by the server.
 */
export const BUCKET_SETTINGS = {
  public: false,
  fileSizeLimit: MAX_RESUME_BYTES,
  allowedMimeTypes: ["application/pdf"],
} as const;

export type StoredObject = {
  key: string;
  /** Bytes, when the listing reports them. */
  size: number | null;
  createdAt: Date | null;
};

type StorageFailure = { message: string; status?: number; statusCode?: string };

// Read per call, not at import: a missing key must fail the request, not the
// boot, and tests set these per case.
function readConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
  };
}

function storage(timeoutMs = STORAGE_TIMEOUT_MS) {
  const { url, serviceRoleKey } = readConfig();
  if (!url) throw new StorageMisconfiguredError("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!serviceRoleKey) throw new StorageMisconfiguredError("SUPABASE_SERVICE_ROLE_KEY is not set");

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // The SDK has no per-call timeout; every request gets one here.
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
    },
  });
  return { buckets: client.storage, files: client.storage.from(RESUME_BUCKET) };
}

const isNotFound = (error: StorageFailure) => error.statusCode === "404" || error.status === 404;

/**
 * For calls the SDK makes without parsing the answer (downloads, HEADs) a
 * failure arrives as the raw response, wrapped; the platform's own code is
 * in its JSON body (HTTP 400 with `statusCode: "404"` for a missing object).
 */
async function isNotFoundResponse(error: StorageFailure & { originalError?: unknown }): Promise<boolean> {
  if (isNotFound(error)) return true;
  const raw = error.originalError;
  if (!(raw instanceof Response)) return false;
  if (raw.status === 404) return true;
  const body = (await raw.clone().json().catch(() => null)) as { statusCode?: unknown } | null;
  return body?.statusCode === "404";
}

/** SDK failures into the app's taxonomy. The message never carries a key. */
function toStorageError(error: unknown, what: string): StorageUnavailableError {
  const detail =
    error instanceof Error && error.name === "TimeoutError"
      ? `timed out after ${STORAGE_TIMEOUT_MS}ms`
      : typeof (error as StorageFailure)?.status === "number"
        ? `HTTP ${(error as StorageFailure).status}`
        : error instanceof Error
          ? error.name
          : "unknown error";
  return new StorageUnavailableError(`Storage ${what} failed: ${detail}`);
}

/**
 * A read URL for one object, valid for `expiresIn` seconds. `null` when the
 * object does not exist, so a row whose file is gone renders a notice
 * instead of a broken frame.
 */
export async function createSignedReadUrl(
  key: string,
  expiresIn: number = SIGNED_READ_TTL_SECONDS,
): Promise<string | null> {
  const { files } = storage();
  let result: Awaited<ReturnType<typeof files.createSignedUrl>>;
  try {
    result = await files.createSignedUrl(key, expiresIn);
  } catch (error) {
    throw toStorageError(error, "signed read");
  }
  if (result.error) {
    if (isNotFound(result.error)) return null;
    throw toStorageError(result.error, "signed read");
  }
  return result.data.signedUrl;
}

/**
 * A single-use URL the browser PUTs the file to, with the token in the
 * query string and nothing else to send: no key of any kind. The bucket's
 * own size and type limits apply to what arrives. Two hours' validity is
 * the platform's, not a choice here.
 */
export async function createSignedUploadUrl(key: string): Promise<string> {
  const { files } = storage();
  let result: Awaited<ReturnType<typeof files.createSignedUploadUrl>>;
  try {
    result = await files.createSignedUploadUrl(key);
  } catch (error) {
    throw toStorageError(error, "signed upload");
  }
  if (result.error) throw toStorageError(result.error, "signed upload");
  return result.data.signedUrl;
}

/**
 * The object's bytes, with the storage timeout on the request. `null` when
 * there is no such object: the caller decides what that means.
 */
export async function downloadObject(key: string): Promise<Uint8Array | null> {
  const { files } = storage();
  let result: Awaited<ReturnType<typeof files.download>>;
  try {
    result = await files.download(key);
  } catch (error) {
    throw toStorageError(error, "download");
  }
  if (result.error) {
    if (await isNotFoundResponse(result.error)) return null;
    throw toStorageError(result.error, "download");
  }
  return new Uint8Array(await result.data.arrayBuffer());
}

/**
 * Deletes by key, so a failed flow doesn't leave an unreferenced file. Never
 * throws: it runs from a catch, and the collector picks up what it misses.
 * False when the delete did not go through.
 */
export async function removeObject(key: string): Promise<boolean> {
  try {
    const { files } = storage();
    const { error } = await files.remove([key]);
    if (error) {
      console.error(`[CVision][storage] remove failed: ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[CVision][storage] remove failed:", error instanceof Error ? error.name : error);
    return false;
  }
}

/**
 * Whether the object exists, by a HEAD request. The SDK answers a 400 or
 * 404 as `data: false` with the raw response attached, and throws for
 * anything else.
 */
export async function objectExists(key: string): Promise<boolean> {
  const { files } = storage();
  try {
    const result = await files.exists(key);
    return result.data === true;
  } catch (error) {
    throw toStorageError(error, "exists");
  }
}

/**
 * Every object under `prefix`, folders walked. For scripts: the listing API
 * is one folder per call, a page at a time.
 */
export async function listObjects(prefix = ""): Promise<StoredObject[]> {
  const { files } = storage();
  const out: StoredObject[] = [];
  const PAGE = 1000;

  let offset = 0;
  for (;;) {
    const { data, error } = await files.list(prefix, { limit: PAGE, offset });
    if (error) throw toStorageError(error, "list");
    for (const entry of data) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A folder comes back without an id: walk it, do not report it.
      if (entry.id === null || entry.id === undefined) {
        out.push(...(await listObjects(key)));
        continue;
      }
      const size = (entry.metadata as { size?: unknown } | null)?.size;
      out.push({
        key,
        size: typeof size === "number" ? size : null,
        createdAt: entry.created_at ? new Date(entry.created_at) : null,
      });
    }
    if (data.length < PAGE) return out;
    offset += PAGE;
  }
}

/** Deletes several objects; for the collector. Throws on failure. */
export async function removeObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { files } = storage();
  const { error } = await files.remove(keys);
  if (error) throw toStorageError(error, "remove");
}

export type BucketSettings = {
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
};

export async function getBucketSettings(): Promise<BucketSettings> {
  const { buckets } = storage();
  const { data, error } = await buckets.getBucket(RESUME_BUCKET);
  if (error) throw toStorageError(error, "get bucket");
  return {
    public: data.public,
    fileSizeLimit: data.file_size_limit ?? null,
    allowedMimeTypes: data.allowed_mime_types ?? null,
  };
}

export async function applyBucketSettings(settings: typeof BUCKET_SETTINGS): Promise<void> {
  const { buckets } = storage();
  const { error } = await buckets.updateBucket(RESUME_BUCKET, {
    public: settings.public,
    fileSizeLimit: settings.fileSizeLimit,
    allowedMimeTypes: [...settings.allowedMimeTypes],
  });
  if (error) throw toStorageError(error, "update bucket");
}

/** The bucket as it is, or null when the project has none by that name. */
export async function findBucketSettings(): Promise<BucketSettings | null> {
  const { buckets } = storage();
  const { data, error } = await buckets.getBucket(RESUME_BUCKET);
  if (error) {
    if (isNotFound(error)) return null;
    throw toStorageError(error, "get bucket");
  }
  return {
    public: data.public,
    fileSizeLimit: data.file_size_limit ?? null,
    allowedMimeTypes: data.allowed_mime_types ?? null,
  };
}

/** Whether what the project holds is exactly `BUCKET_SETTINGS`. */
export function bucketMatches(actual: BucketSettings | null, wanted: typeof BUCKET_SETTINGS = BUCKET_SETTINGS): boolean {
  if (!actual) return false;
  const mimes = [...(actual.allowedMimeTypes ?? [])].sort();
  return actual.public === wanted.public && actual.fileSizeLimit === wanted.fileSizeLimit && mimes.join(",") === [...wanted.allowedMimeTypes].sort().join(",");
}

/**
 * The bucket as the code says it should be, created when the project has
 * none (a production project's first run) and corrected when it differs.
 * Idempotent: a second run reports "unchanged".
 */
export async function ensureBucket(settings: typeof BUCKET_SETTINGS = BUCKET_SETTINGS): Promise<"created" | "updated" | "unchanged"> {
  const current = await findBucketSettings();
  if (current === null) {
    const { buckets } = storage();
    const { error } = await buckets.createBucket(RESUME_BUCKET, {
      public: settings.public,
      fileSizeLimit: settings.fileSizeLimit,
      allowedMimeTypes: [...settings.allowedMimeTypes],
    });
    if (error) throw toStorageError(error, "create bucket");
    return "created";
  }
  if (bucketMatches(current, settings)) return "unchanged";
  await applyBucketSettings(settings);
  return "updated";
}
