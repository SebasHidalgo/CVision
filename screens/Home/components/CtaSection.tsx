import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function CTASection() {
  return (
    <section className="py-24 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
            Ready to transform your hiring process?
          </h2>
          <p className="mt-6 text-lg leading-8 text-muted-foreground text-pretty">
            Join hundreds of companies already using our platform to analyze
            resumes and conduct interviews with AI, finding the perfect talent
            faster than ever.
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="outline" size="lg">
              Talk to Sales
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
