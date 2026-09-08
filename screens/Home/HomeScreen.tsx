import { DimensionsSection } from "./components/DimensionsSection";
import { FinalCtaSection } from "./components/FinalCtaSection";
import { Footer } from "./components/Footer";
import { HeroSection } from "./components/HeroSection";
import { HowItWorksSection } from "./components/HowItWorksSection";
import { InterviewSection } from "./components/InterviewSection";

export default function HomeScreen() {
  return (
    <>
      <HeroSection />
      <HowItWorksSection />
      <DimensionsSection />
      <InterviewSection />
      <FinalCtaSection />
      <Footer />
    </>
  );
}
