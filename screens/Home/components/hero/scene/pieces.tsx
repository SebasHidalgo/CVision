"use client";

import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { DRAW, FLIGHT, T_RULES, T_SCAN0, T_SCAN1 } from "@/screens/Home/components/hero/heroTiming";
import { clamp01, cvRowsLocal, easeInOut, easeOut, fieldPose, slotPose, type Layout } from "./layout";
import { C } from "./textures";

// The scene's objects. Each reads the shared clock (seconds into the reading) in its own frame callback.

type Clock = React.RefObject<number>;
/** Each requirement's connector anchor, in the stage's space; written by the requirement, read by its connector. */
type Anchors = React.RefObject<(THREE.Vector3 | null)[]>;
type LineLike = THREE.Object3D & {
  geometry: { setPositions: (a: number[]) => void };
  material: THREE.Material & { opacity: number; color: THREE.Color };
};

const SQ = 0.42;

function square(size: number) {
  const h = size / 2;
  return [new THREE.Vector3(-h, -h, 0), new THREE.Vector3(h, -h, 0), new THREE.Vector3(h, h, 0), new THREE.Vector3(-h, h, 0), new THREE.Vector3(-h, -h, 0)];
}

const isProven = (r: LocalizedRequirement) => r.status === "met" || r.status === "partial";

/** A requirement: drifts in the field, then flies to its row; proven ones fill with the signal colour on the way. */
export function ReqObject(props: {
  req: LocalizedRequirement;
  index: number;
  start: number;
  L: Layout;
  label: THREE.Texture | null;
  clock: Clock;
  focus: string | null;
  anchors: Anchors;
}) {
  const { req, index, start, L, label, clock, focus, anchors } = props;
  const group = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const outline = useRef<LineLike>(null);
  const labelMat = useRef<THREE.MeshBasicMaterial>(null);
  const field = useMemo(() => fieldPose(index), [index]);
  const slot = useMemo(() => slotPose(index, L), [index, L]);
  const proven = isProven(req);
  const grey = useMemo(() => new THREE.Color(req.status === "notshown" ? C.ink2 : C.ink3), [req.status]);
  const green = useMemo(() => new THREE.Color(C.signal), []);
  // The connector holds the object itself while it flies, and the row's right rule once it is filed.
  const anchorLocal = useMemo(() => new THREE.Vector3(L.matrix.anchorX - L.matrix.cellX, 0, 0), [L]);
  const edgeLocal = useMemo(() => new THREE.Vector3(SQ / 2 + 0.04, 0, 0), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = clock.current ?? 0;
    const fly = clamp01((t - start - (proven ? DRAW : 0.15)) / FLIGHT);
    const u = easeInOut(fly);
    // A slow bob until filed, so the field reads as space, not a picture.
    const bob = (1 - u) * Math.sin(t * 0.9 + index * 1.7) * 0.06;
    g.position.lerpVectors(field.pos, slot.pos, u);
    g.position.y += bob + Math.sin(u * Math.PI) * 0.25;
    g.quaternion.slerpQuaternions(field.quat, slot.quat, u);
    const focused = focus === req.id;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, focused ? 1.06 : 1, 0.25));

    const lit = proven ? easeOut(clamp01((t - start) / DRAW)) : 0;
    if (fill.current) {
      const k = Math.max(0.0001, proven ? easeOut(fly) : 0);
      fill.current.scale.set(k, k, 1);
      fill.current.visible = proven && k > 0.01;
    }
    if (outline.current) {
      outline.current.material.color.copy(grey).lerp(green, lit);
      outline.current.material.opacity = focus && !focused ? 0.35 : 1;
    }
    if (labelMat.current) labelMat.current.opacity = (0.55 + 0.45 * u) * (focus && !focused ? 0.35 : 1);

    const list = anchors.current;
    if (list) {
      g.updateMatrix();
      tmp.lerpVectors(edgeLocal, anchorLocal, easeInOut(clamp01((fly - 0.55) / 0.45)));
      list[index] = (list[index] ?? new THREE.Vector3()).copy(tmp).applyMatrix4(g.matrix);
    }
  });

  const partial = req.status === "partial";
  return (
    <group ref={group}>
      <Line
        ref={outline as never}
        points={square(SQ)}
        color={C.ink3}
        lineWidth={1.6}
        dashed={req.status === "notshown"}
        dashSize={0.055}
        gapSize={0.045}
        transparent
      />
      {proven && (
        <mesh ref={fill} position={[0, partial ? -SQ / 4 : 0, 0]}>
          <boxGeometry args={[SQ - 0.02, partial ? SQ / 2 - 0.01 : SQ - 0.02, 0.07]} />
          <meshStandardMaterial color={C.signal} roughness={0.55} metalness={0} />
        </mesh>
      )}
      {label && (
        <mesh position={[L.matrix.labelX - L.matrix.cellX, 0, 0]}>
          <planeGeometry args={[L.matrix.labelW, L.matrix.labelW * (160 / 1024)]} />
          <meshBasicMaterial ref={labelMat} map={label} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** The thin line from a proven requirement to its CV line: drawn from the CV out, then it follows the object home. */
export function Connector(props: { index: number; start: number; from: THREE.Vector3; clock: Clock; anchors: Anchors; focus: string | null; reqId: string }) {
  const { index, start, from, clock, anchors, focus, reqId } = props;
  const ref = useRef<LineLike>(null);
  const pts = useMemo(() => Array.from({ length: 30 }, () => new THREE.Vector3()), []);
  const flat = useMemo(() => new Array<number>(30 * 3).fill(0), []);
  const curve = useMemo(() => new THREE.CubicBezierCurve3(from.clone(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()), [from]);

  useFrame(() => {
    const line = ref.current;
    const to = anchors.current?.[index];
    if (!line || !to) return;
    const t = clock.current ?? 0;
    const p = easeOut(clamp01((t - start) / DRAW));
    line.visible = p > 0.002;
    if (!line.visible) return;
    curve.v0.copy(from);
    curve.v3.copy(to);
    const dx = Math.max(0.6, Math.abs(from.x - to.x) * 0.45);
    curve.v1.set(from.x - dx, from.y, from.z);
    curve.v2.set(to.x + dx, to.y, to.z);
    for (let i = 0; i < pts.length; i++) {
      curve.getPoint((i / (pts.length - 1)) * p, pts[i]);
      flat[i * 3] = pts[i].x;
      flat[i * 3 + 1] = pts[i].y;
      flat[i * 3 + 2] = pts[i].z;
    }
    line.geometry.setPositions(flat);
    line.material.opacity = focus && focus !== reqId ? 0.22 : 0.9;
  });

  return <Line ref={ref as never} points={[from, from.clone().add(new THREE.Vector3(0.001, 0, 0))]} color={C.signal} lineWidth={1.25} transparent />;
}

/** The CV sheet, the scan line and the mark on each proving line. */
export function CvSheet(props: { L: Layout; map: THREE.Texture | null; lineCount: number; reqs: LocalizedRequirement[]; starts: number[]; clock: Clock }) {
  const { L, map, lineCount, reqs, starts, clock } = props;
  const scan = useRef<THREE.Mesh>(null);
  const marks = useRef<(THREE.Group | null)[]>([]);
  const rows = useMemo(() => cvRowsLocal(lineCount, L), [lineCount, L]);
  const proving = useMemo(() => reqs.map((r, i) => ({ r, i, row: r.line === null ? -1 : r.line - 1 })).filter((x) => x.row >= 0 && isProven(x.r)), [reqs]);
  const gutterX = -L.cv.w / 2 + L.cv.w * 0.1 - L.cv.w * 0.022;

  useFrame(() => {
    const t = clock.current ?? 0;
    const s = scan.current;
    if (s) {
      const u = clamp01((t - T_SCAN0) / (T_SCAN1 - T_SCAN0));
      s.visible = t > T_SCAN0 - 0.2 && t < T_SCAN1 + 0.25;
      s.position.y = THREE.MathUtils.lerp(rows[0] + 0.2, rows[rows.length - 1] - 0.1, u);
      (s.material as THREE.MeshBasicMaterial).opacity = 0.55 * (t > T_SCAN1 ? 1 - clamp01((t - T_SCAN1) / 0.25) : 1);
    }
    proving.forEach((p, k) => {
      const g = marks.current[k];
      if (!g) return;
      const u = easeOut(clamp01((t - starts[p.i]) / DRAW));
      g.scale.set(1, Math.max(0.0001, u), 1);
      g.visible = u > 0.001;
    });
  });

  return (
    <group position={L.cv.pos} rotation={[0, L.cv.rotY, 0]}>
      <mesh>
        <planeGeometry args={[L.cv.w, L.cv.h]} />
        {map ? <meshBasicMaterial map={map} toneMapped={false} /> : <meshBasicMaterial color={C.sheet} toneMapped={false} />}
      </mesh>
      {proving.map((p, k) => (
        <group
          key={p.r.id}
          ref={(el) => {
            marks.current[k] = el;
          }}
          position={[0, rows[p.row], 0.004]}
        >
          <mesh position={[-L.cv.w / 2 + 0.025, 0, 0]}>
            <planeGeometry args={[0.05, (L.cv.h / lineCount) * 0.62]} />
            <meshBasicMaterial color={C.signal} toneMapped={false} />
          </mesh>
          <mesh position={[(gutterX + L.cv.w / 2 - 0.08) / 2, 0, -0.001]}>
            <planeGeometry args={[L.cv.w / 2 - 0.08 - gutterX, (L.cv.h / lineCount) * 0.72]} />
            <meshBasicMaterial color={C.signal} transparent opacity={0.1} toneMapped={false} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <mesh ref={scan} position={[0, rows[0], 0.006]}>
        <planeGeometry args={[L.cv.w - 0.12, 0.012]} />
        <meshBasicMaterial color={C.ink} transparent opacity={0.55} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** The requirement sheet (opaque, edged, there from the start) and its rules, drawn once the requirements are filed. */
export function RequirementSheet({ L, clock, head }: { L: Layout; clock: Clock; head: THREE.Texture | null }) {
  const lines = useRef<(LineLike | null)[]>([]);
  const headMat = useRef<THREE.MeshBasicMaterial>(null);
  const left = L.matrix.cellX - SQ / 2 - 0.08;
  const right = L.matrix.anchorX;
  const rules = useMemo(
    () => [
      [new THREE.Vector3(left, L.matrix.top - 0.08, 0), new THREE.Vector3(right, L.matrix.top - 0.08, 0)],
      [new THREE.Vector3(left, L.matrix.bottom, 0), new THREE.Vector3(right, L.matrix.bottom, 0)],
      [new THREE.Vector3(right, L.matrix.top - 0.08, 0), new THREE.Vector3(right, L.matrix.bottom, 0)],
    ],
    [left, right, L],
  );
  useFrame(() => {
    const u = easeOut(clamp01(((clock.current ?? 0) - T_RULES) / 0.6));
    lines.current.forEach((l) => {
      if (!l) return;
      l.material.opacity = u;
      l.visible = u > 0.001;
    });
    if (headMat.current) headMat.current.opacity = u;
  });
  const sh = L.matrix.sheet;
  const edge = useMemo(
    () => [
      new THREE.Vector3(sh.x0, sh.y0, -0.05),
      new THREE.Vector3(sh.x1, sh.y0, -0.05),
      new THREE.Vector3(sh.x1, sh.y1, -0.05),
      new THREE.Vector3(sh.x0, sh.y1, -0.05),
      new THREE.Vector3(sh.x0, sh.y0, -0.05),
    ],
    [sh],
  );
  return (
    <group position={L.matrix.pos} rotation={[0, L.matrix.rotY, 0]}>
      <mesh position={[(sh.x0 + sh.x1) / 2, (sh.y0 + sh.y1) / 2, -0.06]}>
        <planeGeometry args={[sh.x1 - sh.x0, sh.y1 - sh.y0]} />
        <meshBasicMaterial color={C.sheet} toneMapped={false} />
      </mesh>
      <Line points={edge} color={C.edge} lineWidth={1} />
      {rules.map((pts, i) => (
        <Line
          key={i}
          ref={
            ((el: LineLike | null) => {
              lines.current[i] = el;
            }) as never
          }
          points={pts}
          color={C.rule}
          lineWidth={1}
          transparent
        />
      ))}
      {head && (
        <mesh position={[left + 1.6, L.matrix.top + 0.12, 0]}>
          <planeGeometry args={[3.2, 0.3]} />
          <meshBasicMaterial ref={headMat} map={head} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
