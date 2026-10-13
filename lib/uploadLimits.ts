/**
 * The single source for upload size limits: the upload UI copy, the dropzone,
 * the form schema, the server check after the download, the bucket's own
 * limit and `serverActions.bodySizeLimit` in next.config.ts all read from
 * here. Dependency-free because next.config.ts imports it.
 */

/**
 * The CV goes straight from the browser to storage over a signed URL, so the
 * request never touches a serverless function's body limit. Ten mebibytes
 * covers a CV with photos; bigger is almost always a scan.
 */
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/** How the limit is written in copy. Matches `formatFileSize` output. */
export const MAX_RESUME_SIZE_LABEL = `${MAX_RESUME_BYTES / (1024 * 1024)} MB`;

/**
 * `serverActions.bodySizeLimit`. No action carries a file any more: the
 * largest body is the analysis request, four text fields of bounded length
 * (under 26 KB at three UTF-8 bytes per character, which
 * uploadLimits.test.ts measures). Ten times that worst case.
 */
export const MAX_ACTION_BODY_BYTES = 256 * 1024;
