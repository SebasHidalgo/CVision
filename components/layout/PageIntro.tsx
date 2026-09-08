import Eyebrow from "./Eyebrow";
import { cn } from "@/lib/utils";

type PageIntroProps = {
  eyebrow: string;
  title: React.ReactNode;
  lede?: string;
  /** Right-aligned on wide screens: a figure, an action, a summary line. */
  aside?: React.ReactNode;
  className?: string;
};

export default function PageIntro({
  eyebrow,
  title,
  lede,
  aside,
  className,
}: PageIntroProps) {
  return (
    <header className={cn("border-b border-line pb-8 md:pb-10", className)}>
      <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <Eyebrow tick>{eyebrow}</Eyebrow>
          <h1 className="display-lg mt-5 text-ink">{title}</h1>
          {lede && <p className="lede mt-4 max-w-xl">{lede}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
    </header>
  );
}
