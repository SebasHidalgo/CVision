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
import ErrorMessage from "@/components/shared/ErrorMessage";
import { CreateResumeInput } from "@/types/resume";
import { toast } from "sonner";

export default function UploadForm() {
  const router = useRouter();

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [file, setFile] = useState<File | null>(null);

  const initialValues: CreateResumeInput = {
    companyName: "",
    jobTitle: "",
    jobDescription: "",
    resume: null,
  };

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues: initialValues,
  });

  const handleFileSelect = (file: File | null) => {
    setFile(file);
    setValue("resume", file);
  };

  const onSubmit = async (data: CreateResumeInput) => {
    if (!file) {
      toast.warning("Please upload your resume");
      return;
    }

    setIsProcessing(true);

    const { companyName, jobTitle, jobDescription } = data;

    const body = new FormData();
    body.append("companyName", companyName);
    body.append("jobTitle", jobTitle);
    body.append("jobDescription", jobDescription);
    body.append("resume", file);

    const response = await fetch("/api/resume/analyze", {
      method: "POST",
      body: body,
    });

    const resumeId: string = await response.json();

    setIsProcessing(false);
    router.push(`/resume/analysis/${resumeId}`);
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
            Fill in the job information and upload the candidate's resume for AI
            analysis.
          </CardDescription>
        </CardHeader>
      )}

      <CardContent>
        {isProcessing ? (
          <div>
            <h2 className="text-center text-2xl font-semibold">
              Analizing your resume...
            </h2>
            <p className="text-center text-muted-foreground mt-4 text-sm">
              This may take a few moments.
            </p>
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
                    {...register("companyName", {
                      required: "Company name is required",
                    })}
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
                    {...register("jobTitle", {
                      required: "Job title is required",
                    })}
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
                  {...register("jobDescription", {
                    required: "Job description is required",
                  })}
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
