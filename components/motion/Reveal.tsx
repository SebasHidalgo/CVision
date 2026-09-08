"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

type RevealProps = HTMLMotionProps<"div"> & {
  /** Seconds. Stagger siblings by passing index * 0.08. */
  delay?: number;
  /** Pixels travelled on the way in. */
  y?: number;
};

/** Scroll-triggered entrance. Runs once, never re-hides. */
export default function Reveal({
  delay = 0,
  y = 18,
  children,
  ...props
}: RevealProps) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
