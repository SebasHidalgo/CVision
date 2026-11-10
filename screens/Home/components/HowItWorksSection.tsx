import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import { getT } from "@/lib/i18n/server";

const STEPS = ["paste", "upload", "verdict"] as const;

export async function HowItWorksSection() {
  const t = await getT("landing");
  return (
    <section id="how" className="border-t border-line">
      <div className="wrap py-20 lg:py-28">
        <Reveal className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Eyebrow tick>{t("how.eyebrow")}</Eyebrow>
            <h2 className="display-lg mt-5 text-ink">{t("how.title")}</h2>
          </div>
          <p className="eyebrow max-w-xs md:text-right">{t("how.aside")}</p>
        </Reveal>

        <ol className="mt-14 grid gap-12 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line">
          {STEPS.map((step, i) => (
            <Reveal
              key={step}
              delay={i * 0.1}
              className="md:px-8 md:first:pl-0 md:last:pr-0"
            >
              <li className="group">
                <span className="figure block text-6xl text-ink transition-colors duration-300 group-hover:text-signal md:text-7xl">
                  0{i + 1}
                </span>
                <h3 className="display-sm mt-6 text-ink">{t(`how.steps.${step}.title`)}</h3>
                <p className="mt-3 max-w-sm leading-relaxed text-ink-2">
                  {t(`how.steps.${step}.body`)}
                </p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
