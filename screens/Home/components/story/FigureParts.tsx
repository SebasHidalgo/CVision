"use client";

import { useTranslation } from "react-i18next";
import { INTERVIEW_TIERS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { useFigure, useStoryCase } from "./figureContext";
import { CAP, ReqRow, V } from "./FigureRow";
import { CV_HEAD, CV_ROW, type ItemKey } from "./layout";
import { clock, exampleTally, pad2, PROOFS, type StepId } from "./storyData";

// The object's parts other than the requirement rows. Each one is drawn by the moving stage and by the stills;
// `useFigure().mode` picks the spacing each needs.

/** A shade between the page and the panel: the CV sheet and the feedback tiles sit a step below the object. */
const SHEET_BG = "bg-[color-mix(in_srgb,var(--color-bg)_50%,var(--color-panel))]";

const TALLY = exampleTally();
const PROVEN_LINES = new Set(PROOFS.map((p) => p.line));

function BarLine({ at, cap, className, children }: { at: readonly StepId[]; cap?: string; className?: string; children: React.ReactNode }) {
  const { mode } = useFigure();
  return (
    <V at={at} slot="overlay" className={cn(mode === "stage" ? "flex items-baseline truncate" : "block", className)}>
      {cap && <span className={CAP}>{cap}</span>}
      {children}
    </V>
  );
}

function Bar() {
  const { t } = useTranslation("landingStory");
  const { mode } = useFigure();
  const { company, role } = useStoryCase();
  const posting = `${company} · ${role}`;
  return (
    <div className={cn("relative flex items-center border-b border-line text-ink", mode === "still" && "mb-1 min-h-[46px] py-3")}>
      <BarLine at={["posting"]} cap={t("figure.bar.posting")}>
        {posting}
      </BarLine>
      <BarLine at={["requirements"]} cap={t("figure.bar.read")}>
        {posting}
      </BarLine>
      <BarLine at={["search"]} cap={t("figure.bar.requirements")}>
        {t("figure.bar.requirementsNote")}
      </BarLine>
      <BarLine at={["verdict"]} cap={t("figure.bar.analysis")}>
        {t("figure.bar.analysisNote")}
      </BarLine>
      <BarLine at={["interview"]} className="flex items-center gap-2.5">
        <span aria-hidden className="size-2 flex-none rounded-full bg-ink shadow-[0_0_0_4px_rgb(237_237_234/0.12)]" />
        {t("figure.bar.room")}
        <span className="mono ml-auto pl-4 text-[13.5px] text-ink-2">{clock(INTERVIEW_TIERS.FULL.seconds)}</span>
      </BarLine>
      <BarLine at={["feedback"]} cap={t("figure.bar.feedback")}>
        {t("figure.bar.feedbackNote")}
      </BarLine>
    </div>
  );
}

function Intro() {
  const { t } = useTranslation("landingStory");
  const { mode, step } = useFigure();
  return (
    <div className={cn("grid content-center gap-0.5", mode === "still" && "py-2")}>
      {/* At the requirements step the blurb is read and set aside. */}
      <span className={cn("transition-colors duration-300", step === "requirements" ? "text-ink-3 line-through decoration-ink-3" : "text-ink-2")}>
        {t("figure.intro")}
      </span>
      <V at={["requirements"]} className="text-[13.5px] text-ink-3">
        {t("figure.introNote")}
      </V>
    </div>
  );
}

/** The three headings: the posting's own at first, then the analysis's kinds, then the interviewer's agenda. */
const HEADS = {
  h0: [
    [["posting", "requirements"], "postingRequired"],
    [["verdict"], "required"],
    [["interview"], "agendaGaps"],
  ],
  h1: [
    [["posting", "requirements"], "postingPreferred"],
    [["verdict"], "preferred"],
    [["interview"], "agendaMet"],
  ],
  h2: [[["interview"], "agendaNotShown"]],
} as const satisfies Record<"h0" | "h1" | "h2", readonly (readonly [readonly StepId[], string])[]>;

function Head({ k }: { k: keyof typeof HEADS }) {
  const { t } = useTranslation("landingStory");
  const { mode } = useFigure();
  return (
    <p className={cn("relative flex items-end", CAP, "mr-0", mode === "stage" ? "pb-1.5" : "pb-2 pt-[18px]")}>
      {HEADS[k].map(([at, key]) => (
        <V key={key} at={at} slot="foot">
          {t(`figure.heads.${key}`)}
        </V>
      ))}
    </p>
  );
}

function CvCard() {
  const { t } = useTranslation("landingStory");
  const { mode } = useFigure();
  const { file, cvLines } = useStoryCase();
  return (
    <div className={cn("relative", mode === "still" && "mt-2.5")}>
      <V
        at={["posting", "requirements"]}
        className={cn(
          "mono flex items-center gap-3 rounded-lg border border-dashed border-line-2 px-3.5 text-[13.5px] text-ink",
          mode === "stage" ? "h-full" : "flex-wrap gap-y-0.5 py-3",
        )}
      >
        <span aria-hidden className="h-[22px] w-[18px] flex-none rounded-[2px] border-[1.5px] border-ink-3" />
        <span>{file}</span>
        <span className="text-ink-3">{t("figure.file")}</span>
      </V>
      <V at={["search"]} className={cn("absolute inset-0 grid overflow-hidden rounded-lg border border-line-2", SHEET_BG)}>
        <span className="flex items-center border-b border-line px-3.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3" style={{ height: CV_HEAD }}>
          {t("figure.sheet")}
        </span>
        <span className="grid content-start" style={{ gridAutoRows: CV_ROW }}>
          {cvLines.map((line) => (
            <span
              key={line.n}
              className={cn(
                "relative grid grid-cols-[34px_minmax(0,1fr)] items-center pr-3 text-[14px] text-ink-2",
                PROVEN_LINES.has(line.n) && "bg-signal-wash shadow-proof",
              )}
            >
              <span className="mono pl-2.5 text-[13px] text-ink-3">{pad2(line.n)}</span>
              <span
                className={cn(
                  "truncate",
                  line.kind === "name" && "font-display text-[17px] font-normal text-ink",
                  line.kind === "role" && "font-semibold text-ink",
                  line.kind === "head" && "text-[13px] uppercase tracking-[0.08em] text-ink-3",
                )}
              >
                {line.text}
              </span>
            </span>
          ))}
        </span>
      </V>
    </div>
  );
}

function Tally() {
  const { t } = useTranslation("landingStory");
  const { t: common } = useTranslation("common");
  const { mode } = useFigure();
  const count = ({ met, total, partial }: (typeof TALLY)["required"]) =>
    partial ? t("figure.tally.countPartial", { met, total, partial }) : t("figure.tally.count", { met, total });
  const rows = [
    [t("figure.tally.required"), count(TALLY.required)],
    [t("figure.tally.preferred"), count(TALLY.preferred)],
    [t("figure.tally.notShown"), t("figure.tally.notShownCount", { n: TALLY.notShown })],
  ];
  return (
    <div className={cn("grid content-end gap-2.5 border-t border-line-2 pt-3", mode === "still" && "mt-3")}>
      <dl className="grid gap-1.5 min-[561px]:grid-cols-3 min-[561px]:gap-3">
        {rows.map(([term, value]) => (
          <div key={term} className="flex justify-between gap-3 min-[561px]:block">
            <dt className="text-[13px] text-ink-3">{term}</dt>
            <dd className="mono text-[13.5px] text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[19px] font-semibold tracking-[-0.01em] text-ink">
        <span className={CAP}>{t("figure.tally.verdict")}</span>
        {/* What deriveFitVerdict gives this tally: no required item missing, one partial, one preferred met. */}
        {common("score.fit.fair")}
      </p>
    </div>
  );
}

function Extra() {
  const { t } = useTranslation("landingStory");
  const { mode } = useFigure();
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-center gap-0.5 border-t border-dashed border-line-2 text-[14px] min-[561px]:flex-row min-[561px]:items-center min-[561px]:justify-between min-[561px]:gap-3",
        mode === "still" && "mt-2 min-h-12",
      )}
    >
      <span className={cn(CAP, "mr-0")}>{t("figure.heads.agendaExtra")}</span>
      <span className="text-ink-3">{t("figure.heads.agendaExtraNote")}</span>
    </div>
  );
}

function Outcomes() {
  const { t } = useTranslation("landingStory");
  const { t: landing } = useTranslation("landing");
  const { mode } = useFigure();
  const all = [landing("case.outcome.addressed"), landing("case.outcome.partly"), t("figure.outcomes.dodged"), t("figure.outcomes.notRaised")];
  return (
    <p className={cn("flex flex-wrap items-center border-t border-line text-[13.5px] text-ink-2", mode === "still" && "py-2.5")}>
      <span className={CAP}>{t("figure.outcomes.label")}</span>
      {all.join(" · ")}
    </p>
  );
}

function After() {
  const { t } = useTranslation("landingStory");
  const { mode } = useFigure();
  const parts = [t("figure.after.worked"), t("figure.after.work"), t("figure.after.transcript")];
  return (
    <div className={cn("grid content-center gap-2.5 min-[561px]:grid-cols-3", mode === "still" && "pt-1")}>
      {parts.map((part) => (
        <span key={part} className={cn("grid items-center rounded-lg border border-line-2 px-3 py-2.5 text-[14px] leading-[1.3] text-ink min-[561px]:min-h-14", SHEET_BG)}>
          {part}
        </span>
      ))}
    </div>
  );
}

/** One item of the object, by its layout key. */
export function Item({ k }: { k: ItemKey }) {
  switch (k) {
    case "bar":
      return <Bar />;
    case "intro":
      return <Intro />;
    case "h0":
    case "h1":
    case "h2":
      return <Head k={k} />;
    case "extra":
      return <Extra />;
    case "cv":
      return <CvCard />;
    case "tally":
      return <Tally />;
    case "outcomes":
      return <Outcomes />;
    case "after":
      return <After />;
    default:
      return <ReqRow id={k} />;
  }
}
