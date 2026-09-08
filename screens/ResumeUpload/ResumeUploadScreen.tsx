import UploadForm from "./components/UploadForm";

export default function ResumeUploadScreen() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <section className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-4">
            Upload Resume for Analysis
          </h1>
          <p className="text-muted-foreground text-lg">
            Provide job details and upload a resume to get AI-powered insights
            and matching analysis.
          </p>
        </section>
        <UploadForm />
      </div>
    </div>
  );
}
