import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import { ordinal } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

// The six sections every analysis actually produces. Nothing invented.
const DIMENSIONS = ["ats", "experience", "skills", "education", "tone", "jobFit"] as const;

export async function DimensionsSection() {
  const t = await getT("landing");
  return (
    <section className="border-t border-line">
      <div className="wrap grid gap-12 py-20 lg:grid-cols-12 lg:gap-10 lg:py-28">
        <Reveal className="lg:col-span-4">
          <Eyebrow tick>{t("dimensions.eyebrow")}</Eyebrow>
          <h2 className="display-lg mt-5 text-ink">{t("dimensions.title")}</h2>
          <p className="lede mt-5 max-w-sm">{t("dimensions.lede")}</p>
        </Reveal>

        <ol className="lg:col-span-8">
          {DIMENSIONS.map((dimension, i) => (
            <Reveal key={dimension} delay={i * 0.06}>
              <li className="group grid gap-3 border-t border-line py-6 last:border-b sm:grid-cols-[3.5rem_1fr_1.4fr] sm:items-baseline sm:gap-6">
                <span className="eyebrow text-ink transition-colors duration-300 group-hover:text-signal">
                  {ordinal(i)}
                </span>
                <h3 className="display-sm text-ink">{t(`dimensions.items.${dimension}.name`)}</h3>
                <p className="leading-relaxed text-ink-2">{t(`dimensions.items.${dimension}.body`)}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
