import UploadForm from "@/components/resume/upload-resume/Upload-Form";

export default function UploadResumePage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-4">
            Upload Resume for Analysis
          </h1>
          <p className="text-muted-foreground text-lg">
            Provide job details and upload a resume to get AI-powered insights
            and matching analysis.
          </p>
        </div>
        <UploadForm />
      </div>
    </div>
  );
}
