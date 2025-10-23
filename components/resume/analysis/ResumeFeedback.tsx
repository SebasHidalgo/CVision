import { Card } from "@/components/ui/card";
import { ResumeAnalysisFeedback } from "@/types/resume";
import AtsSection from "./AtsSection";
import OverallScore from "./OverallScore";
import CategoriesDetails from "./CategoriesDetails";
import { InterviewDetails } from "@/types/interview";

type ResumeFeedbackProps = {
  feedback: ResumeAnalysisFeedback;
  interviewDetails: InterviewDetails;
};

export default function ResumeFeedback({
  feedback,
  interviewDetails,
}: ResumeFeedbackProps) {
  const { jobRole, jobDescription, resumeId } = interviewDetails;

  return (
    <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-foreground">
          Resume Feedback
        </h2>

        {/* Overall Score */}
        <OverallScore score={feedback.overall.globalScore} />

        {/* ATS Score Section */}
        <AtsSection
          atsCompatibility={feedback.atsCompatibility}
          interviewDetails={{
            jobRole,
            jobDescription,
            resumeId,
          }}
        />

        {/* Detailed Feedback */}
        <CategoriesDetails feedback={feedback} />
      </div>
    </Card>
  );
}
