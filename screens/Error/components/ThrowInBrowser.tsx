"use client";

import { useEffect, useState } from "react";

/** Dev only: renders nothing on the server, then throws during the first browser render after hydration. */
export default function ThrowInBrowser() {
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(true), []);
  if (armed) throw new Error("Forced in the browser by /dev/error?at=client (dev tools): this message must never reach the page.");
  return null;
}
