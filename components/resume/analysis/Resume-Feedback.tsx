import { Card } from "@/components/ui/card";
import { Feedback } from "@/types/resume";
import AtsSection from "./Ats-Section";
import OverallScore from "./Overall-Score";
import CategoriesDetails from "./Categories-Details";

type ResumeFeedbackProps = {
  feedback: Feedback;
};

export default function ResumeFeedback({ feedback }: ResumeFeedbackProps) {
  return (
    <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-foreground">
          Resume Feedback
        </h2>

        {/* Overall Score */}
        <OverallScore score={feedback.overall.globalScore} />

        {/* ATS Score Section */}
        <AtsSection atsCompatibility={feedback.atsCompatibility} />

        {/* Detailed Feedback */}
        <CategoriesDetails feedback={feedback} />
      </div>
    </Card>
  );
}
