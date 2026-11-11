import { Children, Fragment } from "react";
import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import SignInCtaButton from "@/components/auth/SignInCtaButton";
import ClientMessages from "@/components/i18n/ClientMessages";
import RichText from "@/components/i18n/RichText";
import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { HeroSpecimen } from "./HeroSpecimen";

const CONTENTS = [
  { index: "01", labelKey: "hero.contents.fitVerdict" },
  { index: "02", labelKey: "hero.contents.fixes" },
  { index: "03", labelKey: "hero.contents.interview" },
] as const;

/** One hand-drawn stroke under a word; `joined` carries it across the space to the next word. */
function Stroke({ joined }: { joined: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 300 14"
      preserveAspectRatio="none"
      className={cn(
        "absolute -bottom-[0.06em] left-0 h-[0.16em] overflow-visible text-signal",
        joined ? "w-[calc(100%+0.28em)]" : "w-full",
      )}
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
  );
}

/** The underline under the headline key words, drawn per word so the phrase wraps inside its column. */
function Underlined({ children }: { children?: React.ReactNode }) {
  const words = Children.toArray(children)
    .flatMap((child) => (typeof child === "string" ? child.split(/\s+/) : [child]))
    .filter((word) => word !== "");
  return (
    <>
      {words.map((word, index) => (
        <Fragment key={index}>
          <span className="relative inline-block">
            {word}
            <Stroke joined={index < words.length - 1} />
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

export async function HeroSection() {
  const t = await getT("landing");
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="grid-paper pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 lg:block"
      />

      <div className="wrap relative grid gap-14 pt-14 pb-20 lg:grid-cols-12 lg:items-center lg:gap-10 lg:pt-20 lg:pb-28">
        <div className="lg:col-span-7">
          <Reveal>
            <Eyebrow tick>{t("hero.eyebrow")}</Eyebrow>
          </Reveal>

          <Reveal delay={0.08}>
            <h1 className="display-xl mt-6 text-ink">
              <RichText ns="landing" i18nKey="hero.title" components={{ underline: <Underlined /> }} />
            </h1>
          </Reveal>

          <Reveal delay={0.16}>
            <p className="lede mt-7 max-w-xl">{t("hero.lede")}</p>
          </Reveal>

          <Reveal delay={0.24} className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
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
            <a href="#how" className="link-rule text-sm font-medium text-ink-2">
              {t("hero.howLink")}
            </a>
          </Reveal>

          <Reveal delay={0.34} className="mt-14 hidden sm:block">
            <ol className="flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4">
              {CONTENTS.map((item) => (
                <li key={item.index} className="eyebrow flex items-center gap-3">
                  <span className="text-ink">{item.index}</span>
                  {t(item.labelKey)}
                </li>
              ))}
            </ol>
          </Reveal>
        </div>

        <div className="lg:col-span-5">
          <ClientMessages ns={["landing"]}>
            <HeroSpecimen />
          </ClientMessages>
        </div>
      </div>
    </section>
  );
}
