"use client";

import { motion } from "framer-motion";
import Link from "next/link";

export default function CVisionLogo() {
  return (
    <motion.div
      className="flex items-center justify-center gap-1 select-none"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <motion.span
        className="text-4xl font-extrabold bg-gradient-to-r from-primary to-blue-800 bg-clip-text text-transparent tracking-tight"
        whileHover={{ scale: 1.05 }}
        transition={{ type: "spring", stiffness: 300 }}
      >
        <Link href="/">CVision</Link>
      </motion.span>
    </motion.div>
  );
}
