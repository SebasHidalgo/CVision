"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import FileUploader from "./FileUploader";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ErrorMessage from "./ErrorMessage";
import { toast } from "sonner";
import {
  createResumeInputSchema,
  MAX_JOB_DESCRIPTION_CHARS,
  type CreateResumeInput,
} from "@/lib/schemas/resumeSchema";
import { analyzeResumeAction } from "@/screens/ResumeUpload/actions/analyzeResumeAction";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";

export default function UploadForm() {
  const router = useRouter();

  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const {
    register,
    handleSubmit,
    setValue,
    resetField,
    formState: { errors },
  } = useForm<CreateResumeInput>({
    // Same schema the server action validates with.
    resolver: zodResolver(createResumeInputSchema),
    defaultValues: {
      companyName: "",
      jobTitle: "",
      jobDescription: "",
    },
  });

  const handleFileSelect = (file: File | null) => {
    if (!file) {
      resetField("resume");
      return;
    }
    setValue("resume", file, { shouldValidate: true });
  };

  const onSubmit = async (data: CreateResumeInput) => {
    setIsProcessing(true);

    try {
      const body = new FormData();
      body.append("companyName", data.companyName);
      body.append("jobTitle", data.jobTitle);
      body.append("jobDescription", data.jobDescription);
      body.append("resume", data.resume);

      const result = await analyzeResumeAction(body);

      if (!result.ok) {
        toast.error(actionErrorCopy(result.code));
        return;
      }

      router.push(`/resume/analysis/${result.data.resumeId}`);
    } catch {
      // Network failure or an action that never returned.
      toast.error(actionErrorCopy("UNKNOWN"));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur">
      {!isProcessing && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Job & Resume Details
          </CardTitle>
          <CardDescription>
            Fill in the job information and upload the candidate&apos;s resume
            for AI analysis.
          </CardDescription>
        </CardHeader>
      )}

      <CardContent>
        {isProcessing ? (
          <div>
            <h2 className="text-center text-2xl font-semibold">
              Analyzing your resume...
            </h2>
            <p className="text-center text-muted-foreground mt-4 text-sm">
              This may take a few moments.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/resume-scan.gif"
              alt="Resume scan"
              className="w-84 mx-auto"
            />
          </div>
        ) : (
          <form
            noValidate
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company-name">Company Name</Label>
                <div>
                  <Input
                    id="company-name"
                    maxLength={100}
                    {...register("companyName")}
                    placeholder="Enter company name"
                    className="bg-background/50"
                  />
                  {errors.companyName?.message && (
                    <ErrorMessage text={errors.companyName.message} />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-title">Job Title</Label>
                <div>
                  <Input
                    id="job-title"
                    maxLength={120}
                    {...register("jobTitle")}
                    placeholder="Enter job title"
                    className="bg-background/50"
                  />
                  {errors.jobTitle?.message && (
                    <ErrorMessage text={errors.jobTitle.message} />
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="job-description">Job Description</Label>
              <div>
                <Textarea
                  id="job-description"
                  // This text goes straight into the prompt.
                  maxLength={MAX_JOB_DESCRIPTION_CHARS}
                  {...register("jobDescription")}
                  placeholder="Paste the complete job description here..."
                  className="bg-background/50 resize-none"
                />
                {errors.jobDescription?.message && (
                  <ErrorMessage text={errors.jobDescription.message} />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resume">Resume Upload</Label>

              <FileUploader onFileSelect={handleFileSelect} />
              {errors.resume?.message && (
                <ErrorMessage text={errors.resume.message} />
              )}
            </div>

            <Button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90"
            >
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Analyze Resume with AI
              </>
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
