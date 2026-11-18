import * as THREE from "three";

// Where everything sits in the scene, in world units. The requirement sheet on the left, the CV on the right.

const ROW_GAP = 0.72;

export function makeLayout(rows: number) {
  const top = ((rows - 1) * ROW_GAP) / 2;
  return {
    matrix: {
      pos: new THREE.Vector3(-4.95, 0.05, 0.55),
      rotY: 0.2,
      rowY: (k: number) => top - k * ROW_GAP,
      cellX: -1.62,
      labelX: 0.3,
      labelW: 3.2,
      anchorX: 2.0,
      top: top + 0.55,
      bottom: -top - 0.45,
      sheet: { x0: -2.14, x1: 2.0, y0: -top - 0.62, y1: top + 0.98 },
    },
    // A large, slightly turned sheet with a 320 px-per-unit texture: the CV reads at about 12 CSS px at 1280x720 and
    // 14 at 1440x900 (the body size follows the figure's box, see bodyTexPx).
    cv: { pos: new THREE.Vector3(4.75, -0.05, -0.45), rotY: -0.17, w: 5.6, h: 5.2, texW: 1792, texH: 1664 },
    /** What the camera must keep in view. */
    span: { w: 15.6, h: 6.1 },
  };
}
export type Layout = ReturnType<typeof makeLayout>;

export function groupMatrix(pos: THREE.Vector3, rotY: number) {
  return new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3(1, 1, 1));
}

/** Where each CV line sits on the sheet texture, in texture pixels from the top. */
export function cvRows(count: number, texH: number) {
  const top = texH * 0.06;
  const step = (texH * 0.89) / count;
  return Array.from({ length: count }, (_, i) => top + step * (i + 0.5));
}

/** The same rows in the sheet's own units (y up from its centre). */
export function cvRowsLocal(count: number, L: Layout) {
  return cvRows(count, L.cv.texH).map((px) => L.cv.h / 2 - (px / L.cv.texH) * L.cv.h);
}

/** The body size, in texture px, that lands at about 14 CSS px in a box of this size: 42 to 64 % of a row. */
export function bodyTexPx(L: Layout, rows: number, box: [number, number]) {
  const pxPerUnit = Math.min(box[1] / L.span.h, box[0] / L.span.w);
  const pxPerTexel = pxPerUnit * (L.cv.h / L.cv.texH);
  const row = (L.cv.texH * 0.89) / rows;
  // 14.8 here lands at 14+ on the sheet's far edge (perspective).
  const want = 14.8 / Math.max(0.01, pxPerTexel);
  return Math.round(Math.min(row * 0.64, Math.max(row * 0.42, want)) / 2) * 2;
}

/* ------------------------------------------------------------------ poses */

// A deterministic scatter: the same field on every load.
function rand(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export type Pose = { pos: THREE.Vector3; quat: THREE.Quaternion };

/** Where requirement i floats before it is filed: in front of both sheets and inside the frame. */
export function fieldPose(i: number): Pose {
  const r = (k: number) => rand(i * 7 + k);
  const pos = new THREE.Vector3(-6.0 + r(1) * 6.6, -1.6 + r(2) * 3.2, 1.1 + r(3) * 1.9);
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler((r(4) - 0.5) * 1.0, (r(5) - 0.5) * 1.5, (r(6) - 0.5) * 0.7));
  return { pos, quat };
}

/** Requirement k's row on the requirement sheet. */
export function slotPose(k: number, L: Layout): Pose {
  const m = groupMatrix(L.matrix.pos, L.matrix.rotY);
  const pos = new THREE.Vector3(L.matrix.cellX, L.matrix.rowY(k), 0).applyMatrix4(m);
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, L.matrix.rotY, 0));
  return { pos, quat };
}

export const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
export const easeOut = (u: number) => 1 - (1 - u) ** 3;
export const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
