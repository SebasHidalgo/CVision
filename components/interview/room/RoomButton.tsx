"use client";

import { ArrowRight, Loader2, Phone, PhoneOff, RotateCcw } from "lucide-react";
import { buttonClass } from "@/components/design-system/Button";
import { cn } from "@/lib/utils";

const ICONS = { call: Phone, end: PhoneOff, again: RotateCcw, next: ArrowRight } as const;
type RoomButtonIcon = keyof typeof ICONS;

type RoomButtonProps = {
  /** primary: start, reconnect, continue; danger: end a live call; quiet: a second way out. */
  tone?: "primary" | "danger" | "quiet";
  icon?: RoomButtonIcon;
  /** A spinner in place of the icon: the room is waiting on something. */
  busy?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The room's buttons: pills of the design system. End is filled in the danger colour (white text on it at 5.9:1,
 * 7.1:1 on hover) inside its edge token, which keeps the boundary at 3:1 on every ground in both states.
 */
export function RoomButton({ tone = "primary", icon, busy = false, className, children, type = "button", ...rest }: RoomButtonProps) {
  const Icon = icon ? ICONS[icon] : null;
  return (
    <button
      type={type}
      data-tone={tone}
      className={cn(
        buttonClass({ variant: tone === "quiet" ? "ghost" : "solid", size: "md" }),
        "w-full sm:w-auto",
        tone === "danger" && "border-danger-edge bg-danger text-white hover:bg-danger-hover",
        "disabled:cursor-default disabled:opacity-75 disabled:hover:translate-y-0 disabled:active:scale-100",
        "aria-disabled:cursor-default aria-disabled:opacity-75 aria-disabled:hover:translate-y-0 aria-disabled:active:scale-100",
        className,
      )}
      {...rest}
    >
      {busy ? (
        <Loader2 aria-hidden className="size-[18px] flex-none animate-spin motion-reduce:animate-none" />
      ) : (
        Icon && <Icon aria-hidden className="size-[18px] flex-none" />
      )}
      {children}
    </button>
  );
}
