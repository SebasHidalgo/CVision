import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import SignInCta from "@/components/auth/SignInCta";
import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import { Button } from "@/components/ui/button";
import { HeroSpecimen } from "./HeroSpecimen";

const CONTENTS = [
  { index: "01", label: "Fit score" },
  { index: "02", label: "Priority fixes" },
  { index: "03", label: "Voice mock interview" },
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="grid-paper pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 lg:block"
      />

      <div className="wrap relative grid gap-14 pt-14 pb-20 lg:grid-cols-12 lg:items-center lg:gap-10 lg:pt-20 lg:pb-28">
        <div className="lg:col-span-7">
          <Reveal>
            <Eyebrow tick>CV × job fit, measured</Eyebrow>
          </Reveal>

          <Reveal delay={0.08}>
            <h1 className="display-xl mt-6 text-ink">
              Does your CV{" "}
              <span className="relative inline-block whitespace-nowrap">
                actually fit
                <svg
                  aria-hidden
                  viewBox="0 0 300 14"
                  preserveAspectRatio="none"
                  className="absolute -bottom-[0.06em] left-0 h-[0.16em] w-full overflow-visible text-signal"
                >
                  <path
                    d="M2 9 C 60 3, 120 12, 180 6 S 260 4, 298 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                    pathLength="1"
                    className="[stroke-dasharray:1] [stroke-dashoffset:1] motion-safe:animate-draw motion-reduce:[stroke-dashoffset:0]"
                  />
                </svg>
              </span>{" "}
              the job?
            </h1>
          </Reveal>

          <Reveal delay={0.16}>
            <p className="lede mt-7 max-w-xl">
              Paste the posting, upload your CV, and get read the way a
              demanding recruiter would read you: what matches, what&apos;s
              missing, and what to fix first. Then rehearse the interview out
              loud.
            </p>
          </Reveal>

          <Reveal delay={0.24} className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
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
            <a href="#how" className="link-rule text-sm font-medium text-ink-2">
              See how it works
            </a>
          </Reveal>

          <Reveal delay={0.34} className="mt-14 hidden sm:block">
            <ol className="flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4">
              {CONTENTS.map((item) => (
                <li key={item.index} className="eyebrow flex items-center gap-3">
                  <span className="text-ink">{item.index}</span>
                  {item.label}
                </li>
              ))}
            </ol>
          </Reveal>
        </div>

        <div className="lg:col-span-5">
          <HeroSpecimen />
        </div>
      </div>
    </section>
  );
}
