import { fontText } from "@/components/design-system/fonts";
import ClientMessages from "@/components/i18n/ClientMessages";
import type { Namespace } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import { AnalysisSection } from "./components/analysis/AnalysisSection";
import { SilkBackground } from "./components/background/SilkBackground";
import { ClosingCta } from "./components/closing/ClosingCta";
import { FaqSection } from "./components/faq/FaqSection";
import { LandingFooter } from "./components/footer/LandingFooter";
import { LandingHeader } from "./components/header/LandingHeader";
import { Hero } from "./components/hero/Hero";
import { InterviewSection } from "./components/interview/InterviewSection";
import { PageLoader } from "./components/loader/PageLoader";
import { PricingSection } from "./components/pricing/PricingSection";
import { Story } from "./components/story/Story";

const LANDING_NS = [
  "landing",
  "landingHero",
  "landingStory",
  "landingAnalysis",
  "landingInterview",
  "landingPricing",
  "landingFaq",
] as const satisfies readonly Namespace[];

/** The landing: sections only, in page order. */
export default async function HomeScreen() {
  const t = await getT("landing");
  return (
    <ClientMessages ns={LANDING_NS}>
      <div id="top" className={`ed-root ${fontText.variable} relative flex min-h-dvh flex-1 flex-col`}>
        <PageLoader />
        <SilkBackground />
        <a
          href="#analysis"
          className="absolute -top-16 left-4 z-50 bg-ed-ink px-3.5 py-2.5 font-semibold text-ed-bg focus:top-3"
        >
          {t("skip")}
        </a>
        <LandingHeader />
        <main className="relative z-[1] flex-1">
          <Hero />
          <Story />
          <AnalysisSection />
          <InterviewSection />
          <PricingSection />
          <FaqSection />
          <ClosingCta />
        </main>
        <LandingFooter />
      </div>
    </ClientMessages>
  );
}
