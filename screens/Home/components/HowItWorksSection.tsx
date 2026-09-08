import Eyebrow from "@/components/layout/Eyebrow";
import Reveal from "@/components/motion/Reveal";

const STEPS = [
  {
    title: "Paste the job",
    body: "Company, title and the full description, straight from the posting. That is the yardstick everything gets measured against.",
  },
  {
    title: "Upload your CV",
    body: "One PDF. We read its text layer and compare it with the job, requirement by requirement.",
  },
  {
    title: "Get the verdict",
    body: "A fit score, six scored dimensions and the fixes that move the needle most. Then rehearse the interview for that same job.",
  },
];

export function HowItWorksSection() {
  return (
    <section id="how" className="border-t border-line">
      <div className="wrap py-20 lg:py-28">
        <Reveal className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Eyebrow tick>How it works</Eyebrow>
            <h2 className="display-lg mt-5 text-ink">
              Three steps. About a minute.
            </h2>
          </div>
          <p className="eyebrow max-w-xs md:text-right">
            Runs while you wait. Sign in and go.
          </p>
        </Reveal>

        <ol className="mt-14 grid gap-12 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line">
          {STEPS.map((step, i) => (
            <Reveal
              key={step.title}
              delay={i * 0.1}
              className="md:px-8 md:first:pl-0 md:last:pr-0"
            >
              <li className="group">
                <span className="figure block text-6xl text-ink transition-colors duration-300 group-hover:text-signal md:text-7xl">
                  0{i + 1}
                </span>
                <h3 className="display-sm mt-6 text-ink">{step.title}</h3>
                <p className="mt-3 max-w-sm leading-relaxed text-ink-2">
                  {step.body}
                </p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
