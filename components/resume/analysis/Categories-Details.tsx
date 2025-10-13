import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

import { Feedback } from "@/types/resume";
import { CheckCircle2, ChevronDown, TriangleAlert } from "lucide-react";

interface CategoriesDetailsProps {
  feedback: Feedback;
}
interface CollapsibleBodyProps {
  score: number;
  title: string;
  description: string;
  highlights: string[];
  tips: string[];
}

export default function CategoriesDetails({
  feedback,
}: CategoriesDetailsProps) {
  return (
    <div className="space-y-3">
      <CollapsibleDetails
        title="Experience"
        score={feedback.experience.score}
        tips={feedback.experience.tips}
        description={feedback.experience.description}
        highlights={feedback.experience.highlights}
      />
      <CollapsibleDetails
        title="Education"
        score={feedback.education.score}
        tips={feedback.education.tips}
        description={feedback.education.description}
        highlights={feedback.education.highlights}
      />
      <CollapsibleDetails
        title="Skills"
        score={feedback.skills.score}
        tips={feedback.skills.tips}
        description={feedback.skills.description}
        highlights={feedback.skills.highlights}
      />

      <CollapsibleDetails
        title="Tone & Language"
        score={feedback.toneAndLanguage.score}
        tips={feedback.toneAndLanguage.tips}
        description={feedback.toneAndLanguage.description}
        highlights={feedback.toneAndLanguage.highlights}
      />

      <CollapsibleDetails
        title="Job Description Alignment"
        score={feedback.jobDescriptionAlignment.score}
        tips={feedback.jobDescriptionAlignment.tips}
        description={feedback.jobDescriptionAlignment.description}
        highlights={feedback.jobDescriptionAlignment.highlights}
      />
    </div>
  );
}

function CollapsibleDetails({
  score,
  title,
  tips,
  description,
  highlights,
}: CollapsibleBodyProps) {
  const backgroundColor =
    score > 70 ? "bg-green-700" : score > 49 ? "bg-yellow-700" : "bg-red-700";

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="group-1">
        <AccordionTrigger className="p-4 bg-secondary/50 border-border/50">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">{title}</span>
            <Badge
              variant="outline"
              className={`${backgroundColor} text-white border-0`}
            >
              {score}/100
            </Badge>
          </div>
        </AccordionTrigger>

        <AccordionContent>
          <Card className="mt-2 lg:p-4 bg-secondary/50 border-border/50">
            <CardContent className="space-y-3">
              <p className="text-center">{description}</p>

              {(highlights.length > 0 || tips.length > 0) && (
                <Accordion
                  type="single"
                  collapsible
                  className="w-full space-y-3"
                >
                  {tips.length > 0 && (
                    <AccordionItem value="tips">
                      <AccordionTrigger className="p-4 bg-secondary/50 border-border/50">
                        Tips
                      </AccordionTrigger>

                      <AccordionContent>
                        <Card className="mt-2 lg:p-4 bg-secondary/20 border-border/50">
                          <CardContent className="space-y-3">
                            {tips.map((tip, index) => (
                              <div
                                key={index}
                                className="flex items-center gap-2"
                              >
                                <TriangleAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
                                <span className="text-amber-700 text-sm">
                                  {tip}
                                </span>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {highlights.length > 0 && (
                    <AccordionItem value="highlights">
                      <AccordionTrigger className="p-4 bg-secondary/50 border-border/50">
                        Highlights
                      </AccordionTrigger>

                      <AccordionContent>
                        <Card className="mt-2 lg:p-4 bg-secondary/20 border-border/50">
                          <CardContent className="space-y-3">
                            {highlights.map((highlight, index) => (
                              <div
                                key={index}
                                className="flex items-center gap-2"
                              >
                                <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0" />
                                <span className="text-green-700 text-sm">
                                  {highlight}
                                </span>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
