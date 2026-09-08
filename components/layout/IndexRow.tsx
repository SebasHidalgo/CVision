import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type IndexRowProps = {
  index: string;
  /** Without an href the row renders inert and muted. */
  href?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Date or status, set in the label voice. */
  meta?: React.ReactNode;
  /** The reading on the right: a meter, a status, a figure. */
  reading: React.ReactNode;
  className?: string;
};

const GRID =
  "grid grid-cols-[2.25rem_1fr_1.5rem] gap-x-4 gap-y-4 py-5 md:grid-cols-[3rem_1fr_8.5rem_15rem_2rem] md:items-center md:gap-x-6 md:py-6";

/** One entry of an editorial index: numbered, ruled, and readable as a row. */
export default function IndexRow({
  index,
  href,
  title,
  subtitle,
  meta,
  reading,
  className,
}: IndexRowProps) {
  const body = (
    <>
      <span className="eyebrow pt-1 text-ink transition-colors duration-300 group-hover:text-signal md:pt-0">
        {index}
      </span>

      <div className="min-w-0">
        <h3 className="display-sm truncate text-ink">{title}</h3>
        {subtitle && (
          <p className="mt-1 truncate text-sm text-ink-2 md:text-[15px]">
            {subtitle}
          </p>
        )}
      </div>

      <ArrowUpRight
        aria-hidden
        className="size-5 justify-self-end text-ink-3 transition-all duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink md:order-last"
      />

      <div className="eyebrow col-span-2 col-start-2 md:col-span-1 md:col-start-auto md:order-3">
        {meta}
      </div>

      <div className="col-span-2 col-start-2 md:col-span-1 md:col-start-auto md:order-4">
        {reading}
      </div>
    </>
  );

  if (!href) {
    return (
      <li className={cn(GRID, "opacity-70", className)}>{body}</li>
    );
  }

  return (
    <li className={className}>
      <Link
        href={href}
        className={cn(
          GRID,
          "group -mx-3 px-3 transition-colors duration-200 hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-none md:-mx-4 md:px-4",
        )}
      >
        {body}
      </Link>
    </li>
  );
}
