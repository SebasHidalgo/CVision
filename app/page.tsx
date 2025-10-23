import { CTASection } from "@/components/home/CtaSection";
import { FeaturesSection } from "@/components/home/FeaturesSection";
import { HeroSection } from "@/components/home/HeroSection";
import { WorkflowSection } from "@/components/home/WorkflowSection";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <HeroSection />
      <FeaturesSection />
      <WorkflowSection />
      <CTASection />
    </div>
  );
}
