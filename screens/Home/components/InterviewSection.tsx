import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";
import VoiceOrb from "@/components/voice/VoiceOrb";
import { FEEDBACK_CATEGORIES } from "@/lib/ai/schemas";
import { ordinal } from "@/lib/format";

const BARS = [0.35, 0.7, 1, 0.55, 0.85, 0.45, 0.9, 0.6, 0.3, 0.75, 0.5, 0.95];

/** The one inverted band on the page: a preview of the interview room. */
export function InterviewSection() {
  return (
    <section className="studio bg-paper text-ink">
      <div className="wrap grid gap-14 py-20 lg:grid-cols-12 lg:items-center lg:gap-10 lg:py-32">
        <Reveal className="lg:col-span-6">
          <Eyebrow tick>Then, out loud</Eyebrow>
          <h2 className="display-lg mt-5">
            Rehearse the interview before the real one.
          </h2>
          <p className="lede mt-6 max-w-lg">
            A voice interviewer built from the same job post asks what a hiring
            manager would ask. You answer out loud. When you hang up, you get a
            transcript, a recording, and a score on five things.
          </p>

          <ol className="mt-10 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {FEEDBACK_CATEGORIES.map((category, i) => (
              <li
                key={category}
                className="flex items-baseline gap-4 border-b border-line pb-3"
              >
                <span className="eyebrow text-ink">{ordinal(i)}</span>
                <span className="text-sm font-medium">{category}</span>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal delay={0.15} className="lg:col-span-6">
          <div className="relative mx-auto flex max-w-sm flex-col items-center">
            <VoiceOrb state="listening" className="w-56 sm:w-64" />

            <div
              aria-hidden
              className="mt-10 flex h-10 items-center gap-[5px]"
            >
              {BARS.map((height, i) => (
                <span
                  key={i}
                  className="block w-[3px] rounded-full bg-ink/70 animate-wave"
                  style={{
                    height: `${height * 100}%`,
                    animationDelay: `${i * 0.09}s`,
                  }}
                />
              ))}
            </div>

            <p className="eyebrow mt-6 flex items-center gap-3">
              <span className="size-1.5 rounded-full bg-signal animate-blink" />
              Interviewer is listening
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
