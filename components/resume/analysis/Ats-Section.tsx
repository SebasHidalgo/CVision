import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Feedback } from "@/types/resume";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface AtsSectionProps {
  atsCompatibility: Feedback["atsCompatibility"];
}

export default function AtsSection({ atsCompatibility }: AtsSectionProps) {
  const { score, tips, description, highlights } = atsCompatibility;

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
                  Tips to improve your ATS score
                </AccordionTrigger>
                <AccordionContent>
                  <Card className="mt-2 lg:p-4 bg-secondary border-border/50">
                    <CardContent className="space-y-3">
                      {tips.map((tip, index) => (
                        <div key={index} className="flex items-center gap-2">
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

              <AccordionItem value="item-2">
                <AccordionTrigger className="p-4 bg-secondary border-border/50 hover:bg-secondary/50 transition-colors">
                  Highlights to keep
                </AccordionTrigger>
                <AccordionContent>
                  <Card className="mt-2 lg:p-4 bg-secondary border-border/50">
                    <CardContent className="space-y-3">
                      {highlights.map((highlight, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-700  flex-shrink-0" />

                          <span className="text-green-700 text-sm">
                            {highlight}
                          </span>
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
