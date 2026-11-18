"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { SETTLED, SLOW_FRAME } from "@/screens/Home/components/hero/heroTiming";
import type { Layout } from "./layout";

type Props = {
  clock: React.RefObject<number>;
  run: number;
  /** The textures are drawn: the first frame worth showing. */
  ready: boolean;
  /** The reading may advance (the loader has revealed the page). */
  playing: boolean;
  L: Layout;
  onFirstFrame: () => void;
  onSettled: () => void;
  onSlow: () => void;
};

/** The camera, the clock and the pointer: fits the figure in its box, advances the reading, leans toward the pointer. */
export function Rig({ clock, run, ready, playing, L, onFirstFrame, onSettled, onSlow }: Props) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const scene = useThree((s) => s.scene);
  const stage = useRef<THREE.Object3D | null>(null);
  const told = useRef(false);
  const shown = useRef(false);
  const sample = useRef({ n: 0, sum: 0, done: false });

  // Fit the whole figure in the box, whatever its shape.
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(L.span.h / k, L.span.w / (k * aspect));
    camera.position.set(0, 0.45, d);
    camera.lookAt(0, -0.05, 0);
    camera.updateMatrixWorld();
    invalidate();
  }, [size, camera, invalidate, L]);

  useEffect(() => {
    const wake = () => invalidate();
    window.addEventListener("pointermove", wake, { passive: true });
    return () => window.removeEventListener("pointermove", wake);
  }, [invalidate]);

  useEffect(() => {
    clock.current = 0;
    told.current = false;
    stage.current = scene.getObjectByName("hero-stage") ?? null;
    invalidate();
  }, [run, clock, scene, invalidate]);

  // A frame on demand once the textures land, and when the reading may start.
  useEffect(() => invalidate(), [ready, playing, invalidate]);

  useFrame((state, dt) => {
    if (ready && !shown.current) {
      shown.current = true;
      onFirstFrame();
    }
    const sm = sample.current;
    if (ready && playing && !sm.done) {
      sm.n += 1;
      sm.sum += dt;
      if (sm.n >= 45) {
        sm.done = true;
        if (sm.sum / sm.n > SLOW_FRAME) onSlow();
      }
    }
    if (ready && playing) clock.current = (clock.current ?? 0) + Math.min(dt, 0.1);
    if (!told.current && (clock.current ?? 0) > SETTLED) {
      told.current = true;
      onSettled();
    }
    const g = stage.current;
    if (g) {
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, state.pointer.x * 0.06, 3, dt);
      g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -state.pointer.y * 0.03, 3, dt);
      if (Math.abs(g.rotation.y - state.pointer.x * 0.06) > 0.0005) invalidate();
    }
  });
  return null;
}

/** A change of the stressed requirement asks for a few frames, so the figure eases into it. */
export function FocusFrames({ focus }: { focus: string | null }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let n = 0;
    let raf = 0;
    const tick = () => {
      invalidate();
      if (++n < 20) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [focus, invalidate]);
  return null;
}
