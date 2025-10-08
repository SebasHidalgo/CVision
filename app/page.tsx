import { CTASection } from "@/components/home/Cta-section";
import { FeaturesSection } from "@/components/home/Features-section";
import { HeroSection } from "@/components/home/Hero-section";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <HeroSection />
      <FeaturesSection />
      <CTASection />
    </div>
  );
}
