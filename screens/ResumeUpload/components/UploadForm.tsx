"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";
import {
  createResumeInputSchema,
  MAX_COMPANY_NAME_CHARS,
  MAX_JOB_DESCRIPTION_CHARS,
  MAX_JOB_TITLE_CHARS,
  type CreateResumeInput,
} from "@/lib/schemas/resumeSchema";
import { analyzeResumeAction } from "@/screens/ResumeUpload/actions/analyzeResumeAction";
import { createResumeUploadAction } from "@/screens/ResumeUpload/actions/createResumeUploadAction";
import { runResumeUpload, type UploadStage } from "@/screens/ResumeUpload/utils/upload";
import AnalysisInProgress from "./AnalysisInProgress";
import Field from "./Field";
import FileUploader from "./FileUploader";

export default function UploadForm() {
  const router = useRouter();
  const [stage, setStage] = useState<UploadStage | null>(null);

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
    toast.error(actionErrorCopy(result.code));
    setStage(null);
  };

  if (stage) return <AnalysisInProgress stage={stage} fileSize={resumeFile?.size ?? 0} />;

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div className="grid gap-x-10 gap-y-2 md:grid-cols-2">
        <Field id="company-name" label="Company" error={errors.companyName?.message}>
          <input
            id="company-name"
            type="text"
            autoComplete="organization"
            maxLength={MAX_COMPANY_NAME_CHARS}
            placeholder="Northwind"
            aria-invalid={Boolean(errors.companyName)}
            className="field"
            {...register("companyName")}
          />
        </Field>

        <Field id="job-title" label="Job title" error={errors.jobTitle?.message}>
          <input
            id="job-title"
            type="text"
            autoComplete="organization-title"
            maxLength={MAX_JOB_TITLE_CHARS}
            placeholder="Frontend Engineer"
            aria-invalid={Boolean(errors.jobTitle)}
            className="field"
            {...register("jobTitle")}
          />
        </Field>
      </div>

      <Field
        id="job-description"
        label="Job description"
        hint={`${descriptionLength.toLocaleString("en-US")} / ${MAX_JOB_DESCRIPTION_CHARS.toLocaleString("en-US")}`}
        error={errors.jobDescription?.message}
      >
        <textarea
          id="job-description"
          rows={9}
          // This text goes straight into the prompt.
          maxLength={MAX_JOB_DESCRIPTION_CHARS}
          placeholder="Paste the full posting: responsibilities, requirements, nice-to-haves."
          aria-invalid={Boolean(errors.jobDescription)}
          className="field min-h-[12rem] resize-y leading-relaxed"
          {...register("jobDescription")}
        />
      </Field>

      <Field id="resume" label="Your CV" error={errors.resume?.message}>
        <div className="mt-3">
          <FileUploader
            file={resumeFile ?? null}
            onFileSelect={handleFileSelect}
            invalid={Boolean(errors.resume)}
          />
        </div>
      </Field>

      <div className="flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="eyebrow">Runs while you wait · takes seconds</p>
        <Button type="submit" size="lg" className="group h-12 px-7 text-base">
          Run the analysis
          <ArrowRight className="size-5 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
        </Button>
      </div>
    </form>
  );
}
