"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { TFunction } from "i18next";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import type upload from "@/locales/en/upload.json";
import { analyzeResumeAction } from "@/screens/ResumeUpload/actions/analyzeResumeAction";
import { createResumeUploadAction } from "@/screens/ResumeUpload/actions/createResumeUploadAction";
import { runResumeUpload, type UploadStage } from "@/screens/ResumeUpload/utils/upload";
import AnalysisInProgress from "./AnalysisInProgress";
import Field from "./Field";
import FileUploader from "./FileUploader";

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

/** The one line the form says about the allowance, or nothing. */
export function quotaLine(quota: AnalysisQuotaView, { t, errorCopy, resetDate }: QuotaCopy): string | null {
  if (quota.left === 0) {
    return errorCopy("ANALYSIS_QUOTA_EXCEEDED", { plan: quota.plan, resetsAt: quota.resetsAt });
  }
  if (!quota.announce) return null;
  // The noun follows the allowance ("1 of 3 analyses left"), so the plural is the limit's, not what is left.
  return t("form.quota", { count: quota.limit, left: quota.left, date: resetDate(quota.resetsAt) });
}

export default function UploadForm({ quota }: UploadFormProps) {
  const router = useRouter();
  const { t, i18n } = useTranslation("upload");
  const errorCopy = useErrorCopy();
  const resetDate = useResetDate();
  const locale = useLocale();
  const [stage, setStage] = useState<UploadStage | null>(null);
  const exhausted = quota.left === 0;

  const {
    register,
    handleSubmit,
    setValue,
    resetField,
    watch,
    formState: { errors },
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
    if (!file) {
      resetField("resume");
      return;
    }
    setValue("resume", file, { shouldValidate: true });
  };

  const onSubmit = async (data: CreateResumeInput) => {
    const { resume, ...details } = data;

    // The file goes straight to storage; the action only ever sees its key.
    const result = await runResumeUpload({
      file: resume,
      details,
      createUpload: createResumeUploadAction,
      analyze: analyzeResumeAction,
      onStage: setStage,
    });

    if (result.ok) {
      // Stay on the progress screen: resetting now would bring back a
      // submittable form until the report loads, inviting a double submit.
      router.push(`/resume/analysis/${result.resumeId}`);
      return;
    }

    // Every failure is retryable from the form, with the file still selected.
    toast.error(errorCopy(result.code, result.meta));
    setStage(null);
    // A quota refusal means the page's count is stale: re-read it.
    if (result.code === "ANALYSIS_QUOTA_EXCEEDED") router.refresh();
  };

  if (stage) return <AnalysisInProgress stage={stage} fileSize={resumeFile?.size ?? 0} />;

  const line = quotaLine(quota, { t, errorCopy, resetDate });
  const number = (value: number) => value.toLocaleString(INTL_LOCALE[locale]);

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div className="grid gap-x-10 gap-y-2 md:grid-cols-2">
        <Field id="company-name" label={t("form.company")} error={fieldError(errors.companyName?.message)}>
          <input
            id="company-name"
            type="text"
            autoComplete="organization"
            maxLength={MAX_COMPANY_NAME_CHARS}
            placeholder={t("form.companyPlaceholder")}
            aria-invalid={Boolean(errors.companyName)}
            className="field"
            {...register("companyName")}
          />
        </Field>

        <Field id="job-title" label={t("form.jobTitle")} error={fieldError(errors.jobTitle?.message)}>
          <input
            id="job-title"
            type="text"
            autoComplete="organization-title"
            maxLength={MAX_JOB_TITLE_CHARS}
            placeholder={t("form.jobTitlePlaceholder")}
            aria-invalid={Boolean(errors.jobTitle)}
            className="field"
            {...register("jobTitle")}
          />
        </Field>
      </div>

      <Field
        id="job-description"
        label={t("form.jobDescription")}
        hint={`${number(descriptionLength)} / ${number(MAX_JOB_DESCRIPTION_CHARS)}`}
        error={fieldError(errors.jobDescription?.message)}
      >
        <textarea
          id="job-description"
          rows={9}
          // This text goes straight into the prompt.
          maxLength={MAX_JOB_DESCRIPTION_CHARS}
          placeholder={t("form.jobDescriptionPlaceholder")}
          aria-invalid={Boolean(errors.jobDescription)}
          className="field min-h-[12rem] resize-y leading-relaxed"
          {...register("jobDescription")}
        />
      </Field>

      <Field id="resume" label={t("form.cv")} error={fieldError(errors.resume?.message)}>
        <div className="mt-3">
          <FileUploader
            file={resumeFile ?? null}
            onFileSelect={handleFileSelect}
            invalid={Boolean(errors.resume)}
            disabled={exhausted}
          />
        </div>
      </Field>

      <div className="flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p role={exhausted ? "status" : undefined} className={exhausted ? "text-sm font-medium text-ink" : "eyebrow"}>
          {line ?? t("form.idle")}
        </p>
        <Button type="submit" size="lg" disabled={exhausted} className="group h-12 px-7 text-base">
          {t("form.submit")}
          <ArrowRight className="size-5 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
        </Button>
      </div>
    </form>
  );
}
