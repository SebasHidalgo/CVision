/**
 * The single source for upload size limits: the upload UI copy, the dropzone,
 * the form and server schema, and `serverActions.bodySizeLimit` in
 * next.config.ts all read from here. Dependency-free because next.config.ts
 * imports it.
 */

/**
 * Vercel Functions answer any request body over 4.5 MB with a 413 before the
 * app runs, and no setting raises it. Read as decimal megabytes, the stricter
 * of the two readings.
 */
export const PLATFORM_MAX_BODY_BYTES = 4_500_000;

export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

/** How the limit is written in copy. Matches `formatFileSize` output. */
export const MAX_RESUME_SIZE_LABEL = `${MAX_RESUME_BYTES / (1024 * 1024)} MB`;

/**
 * Everything in the analysis request besides the file: the text fields (under
 * 25 KB even at 3 UTF-8 bytes per character) plus multipart framing. About 10x
 * that worst case, which uploadLimits.test.ts measures.
 */
const FORM_OVERHEAD_BYTES = 256 * 1024;

/**
 * `serverActions.bodySizeLimit`. Next applies it to every Server Action, and
 * the CV upload is by far the largest body any of them receives.
 */
export const MAX_ACTION_BODY_BYTES = MAX_RESUME_BYTES + FORM_OVERHEAD_BYTES;
