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
import FileUploader from "./File-uploader";

export default function UploadForm() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = (file: File | null) => {
    setFile(file);
  };

  const handleSubmit = (e: React.FormEvent) => {};
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
            <h2 className="text-center">{statusText}</h2>
            <img
              src="/images/resume-scan.gif"
              alt="Resume scan"
              className="w-84 mx-auto"
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="company-name">Company Name</Label>
                <Input
                  id="company-name"
                  name="companyName"
                  placeholder="Enter company name"
                  required
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-title">Job Title</Label>
                <Input
                  id="job-title"
                  name="jobTitle"
                  placeholder="Enter job title"
                  required
                  className="bg-background/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="job-description">Job Description</Label>
              <Textarea
                id="job-description"
                name="jobDescription"
                placeholder="Paste the complete job description here..."
                required
                className="bg-background/50 resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resume-upload">Resume Upload</Label>

              <FileUploader onFileSelect={handleFileSelect} />
            </div>

            <Button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90"
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Analyzing Resume...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Analyze Resume with AI
                </>
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
