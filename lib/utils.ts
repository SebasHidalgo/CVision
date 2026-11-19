import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The design system's named sizes and shadows: without them `text-small text-ink-2` reads as two colours.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["h1", "h2", "h3", "title", "lede", "body", "small", "micro", "cap"] }],
      shadow: [{ shadow: ["surface", "proof"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
