import { Button } from "../ui/button";
import { ArrowRight, Sparkles } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />

      <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 inline-flex items-center rounded-full border border-border/40 bg-muted/50 px-3 py-1 text-sm text-muted-foreground">
            <Sparkles className="mr-2 h-4 w-4" />
            Powered by Artificial Intelligence
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl text-balance">
            Analyze resumes with{" "}
            <span className="text-primary">advanced AI</span>
          </h1>

          <p className="mt-6 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto text-pretty">
            Revolutionize your recruitment process with our intelligent analysis
            platform. Identify the best candidates in seconds, not hours.
          </p>

          <div className="mt-10 flex items-center justify-center gap-x-6">
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Start Analysis
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="outline" size="lg">
              View Live Demo
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
