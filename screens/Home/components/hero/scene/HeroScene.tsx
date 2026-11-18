"use client";

// The hero's 3D figure (1024 px and wider, with a hardware GPU and motion allowed; the hero decides). The posting's
// requirements float in front of two opaque sheets; a scan reads the CV, wires each requirement to the line that
// proves it and files it on the requirement sheet. Loaded on demand: three.js never reaches another chunk.

import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { LocalizedCvLine, LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { startTimes } from "@/screens/Home/components/hero/heroTiming";
import { bodyTexPx, cvRowsLocal, groupMatrix, makeLayout } from "./layout";
import { Connector, CvSheet, ReqObject, RequirementSheet } from "./pieces";
import { FocusFrames, Rig } from "./Rig";
import { cvTexture, headTexture, labelTexture, type SceneFaces } from "./textures";

export type HeroSceneProps = {
  requirements: LocalizedRequirement[];
  cvLines: LocalizedCvLine[];
  /** The requirement sheet's heading. */
  head: string;
  /** The computed font stacks of the page's display, text and mono faces. */
  faces: SceneFaces;
  /** Fewer cores: a lower resolution ceiling. */
  lite: boolean;
  /** False while the loader is up: the scene draws its first frame and waits. */
  playing: boolean;
  run: number;
  focus: string | null;
  onFirstFrame: () => void;
  /** The GPU took the context back: the hero shows its HTML figure instead. */
  onLost: () => void;
};

/** The box's size, rounded to 16 px, so a resize redraws the CV texture only when the type size can change. */
function useBoxSize(ref: React.RefObject<HTMLElement | null>): [number, number] {
  const [size, setSize] = useState<[number, number]>([1184, 432]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width / 16) * 16;
      const h = Math.round(entry.contentRect.height / 16) * 16;
      setSize((s) => (s[0] === w && s[1] === h ? s : [w, h]));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Off screen the scene stops drawing. */
function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting), { threshold: 0.02 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

export function HeroScene({ requirements, cvLines, head, faces, lite: liteDevice, playing, run, focus, onFirstFrame, onLost }: HeroSceneProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(wrap);
  const [slow, setSlow] = useState(false);
  const [settled, setSettled] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const clock = useRef(0);
  const anchors = useRef<(THREE.Vector3 | null)[]>([]);
  const L = useMemo(() => makeLayout(requirements.length), [requirements.length]);
  const starts = useMemo(() => startTimes(), []);
  const box = useBoxSize(wrap);
  const body = useMemo(() => bodyTexPx(L, cvLines.length, box), [L, cvLines.length, box]);
  const lite = liteDevice || slow;
  // Callbacks by ref: a new function from the parent never re-creates the canvas's listeners.
  const lost = useRef(onLost);
  const first = useRef(onFirstFrame);
  useEffect(() => {
    lost.current = onLost;
    first.current = onFirstFrame;
  });

  useEffect(() => setSettled(false), [run]);

  // The textures wait for the faces, so the first frame never shows a fallback font.
  useEffect(() => {
    let live = true;
    Promise.all([
      document.fonts.load(`300 100px ${faces.display}`),
      document.fonts.load(`400 66px ${faces.text}`),
      document.fonts.load(`500 66px ${faces.text}`),
      document.fonts.load(`600 62px ${faces.text}`),
      document.fonts.load(`400 40px ${faces.mono}`),
      document.fonts.load(`500 46px ${faces.mono}`),
    ])
      .catch(() => undefined)
      .then(() => {
        if (live) setFontsReady(true);
      });
    return () => {
      live = false;
    };
  }, [faces]);

  const maps = useMemo(() => {
    if (!fontsReady) return null;
    return {
      cv: cvTexture(cvLines, faces, L, body),
      labels: requirements.map((r) => labelTexture(r, faces)),
      head: headTexture(head, faces),
    };
  }, [fontsReady, cvLines, requirements, head, faces, L, body]);
  useEffect(
    () => () => {
      maps?.cv.dispose();
      maps?.labels.forEach((t) => t.dispose());
      maps?.head.dispose();
    },
    [maps],
  );

  // The CV end of each connector, in world space.
  const fromPoints = useMemo(() => {
    const m = groupMatrix(L.cv.pos, L.cv.rotY);
    const rows = cvRowsLocal(cvLines.length, L);
    const x = -L.cv.w / 2 - 0.02;
    return requirements.map((r) => (r.line === null ? null : new THREE.Vector3(x, rows[r.line - 1], 0.01).applyMatrix4(m)));
  }, [L, cvLines.length, requirements]);

  const frameloop = !onScreen ? "never" : !playing || settled ? "demand" : "always";

  return (
    <div ref={wrap} aria-hidden className="absolute inset-0">
      <Canvas
        flat
        frameloop={frameloop}
        dpr={slow ? 1 : lite ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ fov: 26, near: 0.1, far: 60, position: [0, 0.8, 12] }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          // Our own unmount also loses the context (R3F releases it); only a loss while still on the page counts.
          gl.domElement.addEventListener("webglcontextlost", () => {
            if (wrap.current?.isConnected) lost.current();
          });
        }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[3, 4, 6]} intensity={1.6} />
        <group name="hero-stage">
          <CvSheet L={L} map={maps?.cv ?? null} lineCount={cvLines.length} reqs={requirements} starts={starts} clock={clock} />
          <RequirementSheet L={L} clock={clock} head={maps?.head ?? null} />
          {requirements.map((r, i) => (
            <ReqObject
              key={`${run}-${r.id}`}
              req={r}
              index={i}
              start={starts[i]}
              L={L}
              label={maps?.labels[i] ?? null}
              clock={clock}
              focus={focus}
              anchors={anchors}
            />
          ))}
          {requirements.map((r, i) => {
            const from = fromPoints[i];
            return from && (r.status === "met" || r.status === "partial") ? (
              <Connector key={`${run}-c-${r.id}`} index={i} start={starts[i]} from={from} clock={clock} anchors={anchors} focus={focus} reqId={r.id} />
            ) : null;
          })}
        </group>
        <Rig
          clock={clock}
          run={run}
          ready={!!maps}
          playing={playing}
          L={L}
          onFirstFrame={() => first.current()}
          onSettled={() => setSettled(true)}
          onSlow={() => setSlow(true)}
        />
        <FocusFrames focus={focus} />
      </Canvas>
    </div>
  );
}
