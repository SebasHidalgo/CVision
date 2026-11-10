import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import SignInCtaButton from "@/components/auth/SignInCtaButton";
import Reveal from "@/components/motion/Reveal";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

export async function FinalCtaSection() {
  const t = await getT("landing");
  return (
    <section className="border-t border-line">
      <Reveal className="wrap flex flex-col gap-10 py-24 md:flex-row md:items-end md:justify-between lg:py-32">
        <h2 className="display-lg max-w-2xl text-ink">{t("finalCta.title")}</h2>

        <div className="flex flex-col items-start gap-3">
          <SignedOut>
            <SignInCtaButton forceRedirectUrl="/resume/upload" className="group h-12 px-6 text-base" arrow>
              {t("cta.analyze")}
            </SignInCtaButton>
          </SignedOut>
          <SignedIn>
            <Button asChild size="lg" className="group h-12 px-6 text-base">
              <Link href="/resume/upload">
                {t("cta.analyze")}
                <ArrowRight className="size-5 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
              </Link>
            </Button>
          </SignedIn>
          <p className="eyebrow">{t("finalCta.note")}</p>
        </div>
      </Reveal>
    </section>
  );
}
