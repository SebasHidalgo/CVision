import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

type WordmarkProps = {
  size?: "sm" | "lg";
  className?: string;
};

/** Typographic mark: the name set in the display face, closed by a signal dot. */
export default function Wordmark({ size = "sm", className }: WordmarkProps) {
  return (
    <Link
      href="/"
      aria-label={`${BRAND.name} — home`}
      className={cn(
        "group inline-flex items-baseline gap-[0.16em] font-display font-medium tracking-tight text-ink",
        size === "sm" ? "text-[1.375rem]" : "text-[2.25rem]",
        className,
      )}
    >
      <span style={{ fontVariationSettings: '"opsz" 36, "SOFT" 40, "WONK" 1' }}>
        {BRAND.name}
      </span>
      <span
        aria-hidden
        className="mb-[0.06em] inline-block size-[0.26em] origin-left bg-signal transition-transform duration-300 ease-out-expo group-hover:scale-x-[2.4]"
      />
    </Link>
  );
}
