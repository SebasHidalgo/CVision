# File storage

CVs live in one private Supabase Storage bucket, `files-bucket`, under
`cv/{userId}/{uuid}.pdf`. Every storage call goes through
`lib/supabase/server.ts` with the service role; the browser never holds a
Supabase key of any kind.

## The upload never passes through a server function

1. `createResumeUploadAction` mints a key under the caller's prefix and a
   single-use signed upload URL (a second PUT with the same token answers
   409).
2. The browser PUTs the PDF to that URL with the file, its type and
   `cache-control: max-age=0` (stored with the object, so a deleted CV
   stops being served from the CDN within seconds rather than an hour),
   nothing else. The bucket refuses anything that is not `application/pdf`
   or is over the limit in `lib/uploadLimits.ts` (10 MiB) with HTTP 400 and
   `statusCode` 415 or 413 in the body.
3. `analyzeResumeAction` receives the key, checks it is the caller's
   (`isResumeKeyOf`; a foreign key is `NOT_FOUND` and untouched),
   downloads the object, checks the `%PDF-` header and the size, parses the
   text and runs the analysis. Every failure after the download removes the
   object; only a stored row keeps a CV.

The CV drawer reads through a signed URL minted when the drawer opens,
valid for ten minutes (`SIGNED_READ_TTL_SECONDS`). Nothing in the client
stores or builds URLs.

## The bucket as code

`BUCKET_SETTINGS` in `lib/supabase/server.ts` (private, `application/pdf`,
`MAX_RESUME_BYTES`) is applied by:

```bash
npm run storage:setup            # create the bucket if missing, correct it if it differs, then verify
npm run storage:setup -- --check # verify only; exit 1 when anything differs
```

The verification: the settings, the policies on `storage.objects` (which
the Storage API cannot change; **none may exist for `anon`, `authenticated`
or `public`**: the service role bypasses policies and nothing else should
reach the bucket; an offending one is named with the dashboard path,
Storage → Policies), and, when a stored CV exists, that its old public URL
is refused and a signed URL serves the PDF. `prisma/sql/bootstrap.sql`
creates the same bucket from SQL for a database built from scratch, and
`npm run db:bootstrap` runs this check at the end.

## Retention and the collector

A CV lives as long as its `ResumeAnalysis` row. Deleting the analysis or
the account removes the object (best effort, logged). Whatever that misses
is the collector's:

```bash
npm run storage:gc              # every object with a verdict; deletes nothing
npm run storage:gc -- --delete  # removes the orphans, then lists again
```

Orphans are objects under `cv/` that no row references and that are older
than a day (`ORPHAN_GRACE_HOURS`: an upload in progress has no row yet),
and anything outside `cv/`. Supabase's folder placeholders
(`.emptyFolderPlaceholder`) are kept: deleting one deletes the folder. The
logic is `lib/supabase/gc.ts` and the decision `lib/supabase/gcClassify.ts`.
In production the same collector runs daily as a Vercel cron
(`vercel.json` → `GET /api/cron/storage-gc`, authenticated by the
`CRON_SECRET` bearer Vercel sends; the route refuses everything, loudly,
when the secret is not configured).

`NEXT_PUBLIC_SUPABASE_URL` is read on the server only; the prefix is
history and exposes nothing (the URL travels inside every signed URL).
