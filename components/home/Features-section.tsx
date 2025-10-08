import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Brain, Zap, Shield, BarChart3 } from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "Smart Analysis",
    description:
      "Our AI analyzes skills, experience, and cultural fit with advanced precision.",
  },
  {
    icon: Zap,
    title: "Fast Processing",
    description:
      "Analyzes hundreds of resumes in minutes, not days. Accelerate your selection process.",
  },
  {
    icon: Shield,
    title: "Privacy Guaranteed",
    description:
      "Full compliance with GDPR. Your data and that of candidates are completely secure.",
  },
  {
    icon: BarChart3,
    title: "Detailed Insights",
    description:
      "Get comprehensive reports with scores, comparisons, and personalized recommendations.",
  },
];

export function FeaturesSection() {
  return (
    <section className="py-24 sm:py-32 bg-muted/20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
            The most advanced platform for resume analysis
          </h2>
          <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty">
            Combine cutting-edge artificial intelligence with an intuitive
            interface to transform your recruiting process.
          </p>
        </div>

        <div className="mx-auto mt-16 max-w-5xl">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="border-border/40 bg-card/50 backdrop-blur"
              >
                <CardHeader>
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg font-semibold text-card-foreground">
                    {feature.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-muted-foreground">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
