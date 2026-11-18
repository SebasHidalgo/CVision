"use client";

import { useEffect, useRef } from "react";

type RevealProps = React.ComponentPropsWithoutRef<"div"> & {
  /** Seconds. Stagger siblings by passing index * 0.08. */
  delay?: number;
};

/**
 * Scroll-triggered entrance. Runs once, never re-hides. The hidden state is CSS under html[data-js] (globals.css),
 * so the server HTML and a page without JavaScript show the content.
 */
export default function Reveal({ delay = 0, style, children, ...props }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.setAttribute("data-shown", "");
        io.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} data-reveal="" style={{ ...style, ["--reveal-delay" as string]: `${delay}s` }} {...props}>
      {children}
    </div>
  );
}
