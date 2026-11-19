"use client";

import dynamic from "next/dynamic";

// The shader and its loop load after the page paints, in their own chunk.
const SilkGround = dynamic(() => import("./SilkGround"), { ssr: false, loading: () => null });

type Props = {
  /**
   * The element whose visibility lets the ground move (a CSS selector; default: the hero section). Below it, behind
   * the reading, the ground holds its last frame. With no match the ground always moves (hidden tabs still pause it).
   */
  watch?: string;
};

/**
 * The landing's ground: dark silk in slow folds, fixed behind the whole page. Content never sits on it directly: it
 * lies on solid surfaces, and text on the open page uses ink-2 at most dim (`.root` maps ink-3 to it), which keeps
 * AA on the brightest pixel the ground can draw. Under reduced motion or software rendering it draws one still
 * frame; without WebGL, or after a lost context, it shows the same frame as an image. Render it once, as the first
 * child of the page root, with the content above it (`relative z-[1]`).
 */
export function SilkBackground({ watch = "[data-hero-section]" }: Props) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-bg">
      <SilkGround watch={watch} />
    </div>
  );
}
