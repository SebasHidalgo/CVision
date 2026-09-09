import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import SignInCta from "@/components/auth/SignInCta";
import Reveal from "@/components/motion/Reveal";
import { Button } from "@/components/ui/button";

export function FinalCtaSection() {
  return (
    <section className="border-t border-line">
      <Reveal className="wrap flex flex-col gap-10 py-24 md:flex-row md:items-end md:justify-between lg:py-32">
        <h2 className="display-lg max-w-2xl text-ink">
          Your next application deserves a second opinion.
        </h2>

        <div className="flex flex-col items-start gap-3">
          <SignedOut>
            <SignInCta forceRedirectUrl="/resume/upload">
              <Button size="lg" className="group h-12 px-6 text-base">
                Analyze my CV
                <ArrowRight className="size-5 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
              </Button>
            </SignInCta>
          </SignedOut>
          <SignedIn>
            <Button asChild size="lg" className="group h-12 px-6 text-base">
              <Link href="/resume/upload">
                Analyze my CV
                <ArrowRight className="size-5 transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
              </Link>
            </Button>
          </SignedIn>
          <p className="eyebrow">One PDF. About a minute.</p>
        </div>
      </Reveal>
    </section>
  );
}
