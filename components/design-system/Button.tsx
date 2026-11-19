import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "solid" | "ghost";
type Size = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border font-semibold no-underline cursor-pointer " +
  "transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.97] " +
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100";
const VARIANT: Record<Variant, string> = {
  solid: "border-ink bg-ink text-bg",
  ghost: "border-line-2 bg-transparent text-ink hover:border-ink-2",
};
// Touch targets stay at 44 px or more.
const SIZE: Record<Size, string> = {
  md: "min-h-12 px-[22px] text-[15.5px]",
  sm: "min-h-11 px-4 text-[14.5px] md:min-h-10",
};

/** The pill button's classes, for a <button>, a <Link> or a component that renders its own element. */
export function buttonClass({ variant = "solid", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

/** A link styled as the pill button. */
export function ButtonLink({
  href,
  variant,
  size,
  className,
  children,
  ...rest
}: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<
  React.ComponentPropsWithoutRef<typeof Link>,
  "href" | "className" | "children"
>) {
  return (
    <Link href={href} className={buttonClass({ variant, size, className })} {...rest}>
      {children}
    </Link>
  );
}

/** A quiet text action: underline on hover, 44 px tall. */
export const textLinkClass =
  "inline-flex min-h-11 items-center bg-transparent px-0.5 text-[15px] text-ink-2 no-underline cursor-pointer hover:text-ink hover:underline hover:underline-offset-4";
