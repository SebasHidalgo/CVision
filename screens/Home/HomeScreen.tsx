import { CTASection } from "./components/CtaSection";
import { FeaturesSection } from "./components/FeaturesSection";
import { HeroSection } from "./components/HeroSection";
import { WorkflowSection } from "./components/WorkflowSection";

export default function HomeScreen() {
  return (
    <div className="min-h-screen bg-background">
      <HeroSection />
      <FeaturesSection />
      <WorkflowSection />
      <CTASection />
    </div>
  );
}
