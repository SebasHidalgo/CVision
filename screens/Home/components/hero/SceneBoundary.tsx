"use client";

import { Component, type ReactNode } from "react";

type Props = { onError: () => void; children: ReactNode };

/** Catches a 3D chunk that fails to load or a scene that throws: the hero then shows its HTML figure. */
export class SceneBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[CVision][hero] 3D figure failed; showing the HTML figure", error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
