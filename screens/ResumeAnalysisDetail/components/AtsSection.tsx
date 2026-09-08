"use client";

import { CheckCircle2, TriangleAlert, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { ResumeAnalysisFeedback } from "@/types/resume";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createInterviewAction } from "@/screens/ResumeAnalysisDetail/actions/createInterviewAction";
import { actionErrorCopy } from "@/lib/error/actionErrorCopy";

interface AtsSectionProps {
  atsCompatibility: ResumeAnalysisFeedback["atsCompatibility"];
  resumeId: string;
}

export default function AtsSection({
  atsCompatibility,
  resumeId,
}: AtsSectionProps) {
  const { score, description, evidence, fixes, problems } = atsCompatibility;
  const [isCreatingInterview, setIsCreatingInterview] = useState(false);
  const router = useRouter();

  const subtitle =
    score > 69
      ? "Awesome job!"
      : score > 49
        ? "Solid start"
        : "Requires improvement";

  const handleSimulateInterview = async () => {
    setIsCreatingInterview(true);

    const result = await createInterviewAction({ resumeId });

    if (!result.ok) {
      // Reset the button instead of navigating to /interview/undefined.
      setIsCreatingInterview(false);
      toast.error(actionErrorCopy(result.code));
      return;
    }

    router.push(`/interview/${result.data.interviewId}`);
  };

  return (
    <Card className="bg-secondary/50 border-border/50">
      <CardContent className="space-y-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">
            ATS Score - {score}/100
          </h3>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-2">{subtitle}</h3>
          <p className="text-gray-600 mb-4">{description}</p>

          <div className="space-y-3">
            <Accordion type="single" collapsible className="space-y-3">
              <AccordionItem value="item-1">
                <AccordionTrigger className="p-4 bg-secondary border-border/50 hover:bg-secondary/50 transition-colors">
                  Warnings to fix
                </AccordionTrigger>
                <AccordionContent>
                  <Card className="mt-2 lg:p-4 bg-secondary border-border/50">
                    <CardContent className="space-y-3">
                      {problems.map((problem, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <TriangleAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
                          <span className="text-amber-700 text-sm">
                            {problem}
                          </span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="item-2">
                <AccordionTrigger className="p-4 bg-secondary border-border/50 hover:bg-secondary/50 transition-colors">
                  Ways to fix it
                </AccordionTrigger>
                <AccordionContent>
                  <Card className="mt-2 lg:p-4 bg-secondary border-border/50">
                    <CardContent className="space-y-3">
                      {fixes.map((fix, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-700  flex-shrink-0" />

                          <span className="text-green-700 text-sm">{fix}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="item-3">
                <AccordionTrigger className="p-4 bg-secondary border-border/50 hover:bg-secondary/50 transition-colors">
                  Evidence found
                </AccordionTrigger>
                <AccordionContent>
                  <Card className="mt-2 lg:p-4 bg-secondary border-border/50">
                    <CardContent className="space-y-3">
                      {evidence.map((e, index) => (
                        <div key={index}>
                          <span className="text-sm">• {e}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>

        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <h4 className="text-lg font-semibold text-foreground mb-2">
                    Ready for the next step?
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Practice your interview skills with our AI-powered mock
                    interview. Get personalized feedback and improve your
                    chances of landing the job.
                  </p>
                </div>
                <Button
                  onClick={handleSimulateInterview}
                  disabled={isCreatingInterview}
                  className="w-full sm:w-auto bg-primary hover:bg-primary/90"
                >
                  {isCreatingInterview ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Creating Interview...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Start Mock Interview
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
}
