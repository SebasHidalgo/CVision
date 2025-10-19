import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Feedback } from "@/types/resume";

interface AtsSectionProps {
  atsCompatibility: Feedback["atsCompatibility"];
}

export default function AtsSection({ atsCompatibility }: AtsSectionProps) {
  const { score, description, evidence, fixes, problems } = atsCompatibility;

  const subtitle =
    score > 69
      ? "Awesome job!"
      : score > 49
      ? "Solid start"
      : "Requires improvement";
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
      </CardContent>
    </Card>
  );
}
