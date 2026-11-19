"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { TFunction } from "i18next";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/components/design-system/Button";
import { useErrorCopy, useResetDate } from "@/hooks/useErrorCopy";
import { useLocale } from "@/hooks/useLocale";
import type { ErrorCode, ErrorMeta } from "@/lib/error/errors";
import { INTL_LOCALE } from "@/lib/i18n/config";
import type { AnalysisQuotaView } from "@/lib/plans";
import {
  createResumeInputSchema,
  MAX_COMPANY_NAME_CHARS,
  MAX_JOB_DESCRIPTION_CHARS,
  MAX_JOB_TITLE_CHARS,
  type CreateResumeInput,
} from "@/lib/schemas/resumeSchema";
import { MAX_RESUME_SIZE_LABEL } from "@/lib/uploadLimits";
import { cn } from "@/lib/utils";
import type upload from "@/locales/en/upload.json";
import { analyzeResumeAction } from "@/screens/ResumeUpload/actions/analyzeResumeAction";
import { createResumeUploadAction } from "@/screens/ResumeUpload/actions/createResumeUploadAction";
import type { RunClock, RunPhase } from "@/screens/ResumeUpload/utils/runSteps";
import { runResumeUpload, submissionKeyFor, type Submission, type UploadStage } from "@/screens/ResumeUpload/utils/upload";
import AnalysisInProgress, { type SentDetails } from "./AnalysisInProgress";
import FailureNotice from "./FailureNotice";
import Field, { errorIdOf, fieldClass } from "./Field";
import FileUploader, { DROPZONE_ID } from "./FileUploader";
import FormRow from "./FormRow";
import { QUOTA_STATUS_ID, QuotaCount, QuotaExhausted } from "./QuotaNotice";

type UploadFormProps = {
  quota: AnalysisQuotaView;
};

/** The schema's messages are keys of the upload namespace (lib/schemas/resumeSchema.ts). */
type ValidationKey = `validation.${keyof (typeof upload)["validation"]}`;

type QuotaCopy = {
  t: TFunction<"upload">;
  errorCopy: (code: ErrorCode, meta?: ErrorMeta) => string;
  resetDate: (resetsAt: string) => string;
};

type Run = { phase: RunPhase; startedAt: RunClock; sent: SentDetails };
type Failure = { code: ErrorCode; meta?: ErrorMeta; stage: UploadStage };

// A failure about the file itself is stale once another file is picked.
const FILE_CODES: ReadonlySet<ErrorCode> = new Set(["PDF_UNREADABLE", "PDF_NO_TEXT", "PDF_SCANNED", "NOT_A_PDF", "FILE_TOO_LARGE"]);

const NOTE = { role: "row-role-note", posting: "row-posting-note", cv: "row-cv-note" } as const;
const COUNTER_ID = "job-description-count";
const CV_LABEL_ID = "resume-label";

/** The one line the form says about the allowance, or nothing. */
export function quotaLine(quota: AnalysisQuotaView, { t, errorCopy, resetDate }: QuotaCopy): string | null {
  if (quota.left === 0) {
    return errorCopy("ANALYSIS_QUOTA_EXCEEDED", { plan: quota.plan, resetsAt: quota.resetsAt });
  }
  if (!quota.announce) return null;
  // The noun follows the allowance ("1 of 3 analyses left"), so the plural is the limit's, not what is left.
  return t("form.quota", { count: quota.limit, left: quota.left, date: resetDate(quota.resetsAt) });
}

/** A control's description: the row's note, then its error when it has one. */
const describedBy = (note: string, error: unknown, id: string, ...extra: string[]) =>
  [note, ...extra, error ? errorIdOf(id) : null].filter(Boolean).join(" ");

export default function UploadForm({ quota }: UploadFormProps) {
  const router = useRouter();
  const { t, i18n } = useTranslation("upload");
  const errorCopy = useErrorCopy();
  const resetDate = useResetDate();
  const locale = useLocale();
  const [run, setRun] = useState<Run | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // The last submission that did not open its analysis: sending it again reuses its key, so a response lost on
  // the way back opens the analysis it saved instead of running (and charging) a second one.
  const lastSubmission = useRef<Submission | null>(null);
  const exhausted = quota.left === 0;

  const {
    register,
    handleSubmit,
    setValue,
    resetField,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateResumeInput>({
    // Same fields the server action validates with, plus the file.
    resolver: zodResolver(createResumeInputSchema),
    defaultValues: {
      companyName: "",
      jobTitle: "",
      jobDescription: "",
    },
  });

  const descriptionLength = watch("jobDescription").length;
  const resumeFile = watch("resume");

  // A message the schema did not name as a key (a library default) reads as the generic one.
  const fieldError = (message: string | undefined) => {
    if (message === undefined) return undefined;
    return i18n.exists(message, { ns: "upload" })
      ? t(message as ValidationKey, { size: MAX_RESUME_SIZE_LABEL })
      : t("validation.invalid");
  };

  const handleFileSelect = (file: File | null) => {
    setFailure((current) => (current && FILE_CODES.has(current.code) ? null : current));
    if (!file) {
      resetField("resume");
      return;
    }
    setValue("resume", file, { shouldValidate: true });
  };

  // Each phase's start, as this tab saw it: the progress view shows how long each step really took.
  const enter = (phase: RunPhase) => {
    // Read outside the updater: Strict Mode runs updaters twice.
    const at = Date.now();
    setRun((current) => (current ? { ...current, phase, startedAt: { ...current.startedAt, [phase]: at } } : current));
  };

  const onSubmit = async (data: CreateResumeInput) => {
    const { resume, ...details } = data;
    const submissionKey = submissionKeyFor(lastSubmission.current, details, resume);
    lastSubmission.current = { key: submissionKey, details, file: resume };
    setFailure(null);
    setRun({
      phase: "uploading",
      startedAt: { uploading: Date.now() },
      sent: { companyName: details.companyName, jobTitle: details.jobTitle, fileName: resume.name, fileSize: resume.size },
    });

    // The file goes straight to storage; the action only ever sees its key.
    const result = await runResumeUpload({
      file: resume,
      details,
      submissionKey,
      createUpload: createResumeUploadAction,
      analyze: analyzeResumeAction,
      onStage: enter,
    });

    if (result.ok) {
      lastSubmission.current = null;
      // Stay on the progress view: resetting now would bring back a
      // submittable form until the report loads, inviting a double submit.
      enter("opening");
      router.push(`/resume/analysis/${result.resumeId}`);
      return;
    }

    // Every failure is retryable from the form, with the file still selected.
    setRun(null);
    // The form remounts with it, so the notice mounts fresh and takes focus each time.
    setFailure({ code: result.code, meta: result.meta, stage: result.stage });
    // A quota refusal means the page's count is stale: re-read it.
    if (result.code === "ANALYSIS_QUOTA_EXCEEDED") router.refresh();
  };

  // React Hook Form focuses the first invalid text control; the file is not one, so it gets focus here.
  const onInvalid = (invalid: FieldErrors<CreateResumeInput>) => {
    if (invalid.resume && !invalid.companyName && !invalid.jobTitle && !invalid.jobDescription) {
      document.getElementById(DROPZONE_ID)?.focus();
    }
  };

  if (run) return <AnalysisInProgress phase={run.phase} startedAt={run.startedAt} sent={run.sent} />;

  const line = quotaLine(quota, { t, errorCopy, resetDate });
  const number = (value: number) => value.toLocaleString(INTL_LOCALE[locale]);
  const companyError = fieldError(errors.companyName?.message);
  const jobTitleError = fieldError(errors.jobTitle?.message);
  const descriptionError = fieldError(errors.jobDescription?.message);
  const resumeError = fieldError(errors.resume?.message);

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit, onInvalid)}>
      {exhausted && line && <QuotaExhausted quota={quota} line={line} />}

      <FormRow n="01" title={t("rows.role.title")} note={t("rows.role.body")} noteId={NOTE.role}>
        <div className="grid gap-x-ed-gutter md:grid-cols-2">
          <Field id="company-name" label={t("form.company")} error={companyError}>
            <input
              id="company-name"
              type="text"
              autoComplete="organization"
              maxLength={MAX_COMPANY_NAME_CHARS}
              placeholder={t("form.companyPlaceholder")}
              aria-required
              aria-invalid={Boolean(errors.companyName)}
              aria-describedby={describedBy(NOTE.role, companyError, "company-name")}
              className={fieldClass}
              {...register("companyName")}
            />
          </Field>
          <Field id="job-title" label={t("form.jobTitle")} error={jobTitleError}>
            <input
              id="job-title"
              type="text"
              autoComplete="organization-title"
              maxLength={MAX_JOB_TITLE_CHARS}
              placeholder={t("form.jobTitlePlaceholder")}
              aria-required
              aria-invalid={Boolean(errors.jobTitle)}
              aria-describedby={describedBy(NOTE.role, jobTitleError, "job-title")}
              className={fieldClass}
              {...register("jobTitle")}
            />
          </Field>
        </div>
      </FormRow>

      <FormRow
        n="02"
        title={<label htmlFor="job-description">{t("rows.posting.title")}</label>}
        note={t("rows.posting.body")}
        noteId={NOTE.posting}
      >
        <Field
          id="job-description"
          error={descriptionError}
          hint={
            <p id={COUNTER_ID} className="ed-mono shrink-0 pt-0.5 text-[13px] text-ed-ink-3">
              <span className="sr-only">{t("form.characters")} </span>
              {`${number(descriptionLength)} / ${number(MAX_JOB_DESCRIPTION_CHARS)}`}
            </p>
          }
        >
          <textarea
            id="job-description"
            rows={10}
            // This text goes straight into the prompt.
            maxLength={MAX_JOB_DESCRIPTION_CHARS}
            placeholder={t("form.jobDescriptionPlaceholder")}
            aria-required
            aria-invalid={Boolean(errors.jobDescription)}
            aria-describedby={describedBy(NOTE.posting, descriptionError, "job-description", COUNTER_ID)}
            className={cn(fieldClass, "min-h-60 resize-y leading-relaxed")}
            {...register("jobDescription")}
          />
        </Field>
      </FormRow>

      <FormRow
        n="03"
        title={
          <label id={CV_LABEL_ID} htmlFor="resume">
            {t("rows.cv.title")}
          </label>
        }
        note={t("rows.cv.body")}
        noteId={NOTE.cv}
      >
        <Field id="resume" error={resumeError}>
          <FileUploader
            file={resumeFile ?? null}
            onFileSelect={handleFileSelect}
            labelId={CV_LABEL_ID}
            describedBy={describedBy(NOTE.cv, resumeError, "resume")}
            invalid={Boolean(errors.resume)}
            disabled={exhausted}
          />
        </Field>
      </FormRow>

      <div className="ed-grid gap-y-6 border-t border-ed-line-2 pt-[clamp(24px,3.5vw,40px)]">
        <div className="grid gap-6 lg:col-[5/span_8] lg:max-w-[75ch]">
          {failure && (
            <FailureNotice stage={failure.stage} message={errorCopy(failure.code, failure.meta)} />
          )}
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            {!exhausted && <QuotaCount quota={quota} line={line} idle={t("form.idle")} />}
            <button
              type="submit"
              disabled={exhausted || isSubmitting}
              aria-describedby={exhausted ? QUOTA_STATUS_ID : undefined}
              className={buttonClass({
                className:
                  "group ml-auto disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:active:scale-100 max-sm:ml-0",
              })}
            >
              {t("form.submit")}
              <ArrowRight
                aria-hidden
                className="size-[18px] transition-transform duration-200 ease-ed-out group-hover:translate-x-0.5 group-disabled:translate-x-0 motion-reduce:transition-none"
              />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
