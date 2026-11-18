import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The design system's named sizes and shadows: without them `text-ed-small text-ed-ink-2` reads as two colours.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["ed-h1", "ed-h2", "ed-h3", "ed-title", "ed-lede", "ed-body", "ed-small", "ed-micro", "ed-cap"] }],
      shadow: [{ shadow: ["ed-surface", "ed-proof"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
