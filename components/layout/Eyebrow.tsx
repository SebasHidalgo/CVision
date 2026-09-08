import { cn } from "@/lib/utils";

type EyebrowProps = {
  children: React.ReactNode;
  /** Editorial numbering, e.g. "01". */
  index?: string;
  /** Leading signal mark. */
  tick?: boolean;
  as?: "p" | "span" | "h2" | "h3";
  className?: string;
};

/** Mono, uppercase, tracked: the label voice used across the product. */
export default function Eyebrow({
  children,
  index,
  tick = false,
  as: Tag = "p",
  className,
}: EyebrowProps) {
  return (
    <Tag className={cn("eyebrow flex items-center gap-3", className)}>
      {tick && <span aria-hidden className="size-1.5 shrink-0 bg-signal" />}
      {index && <span className="text-ink">{index}</span>}
      <span>{children}</span>
    </Tag>
  );
}
