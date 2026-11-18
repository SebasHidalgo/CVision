import * as THREE from "three";
import type { LocalizedCvLine, LocalizedRequirement } from "@/screens/Home/hooks/useExampleCase";
import { cvRows, type Layout } from "./layout";

// The scene's text, drawn once on 2D canvases and used as textures.

export type SceneFaces = { display: string; text: string; mono: string };

// The design system's colours (tokens.css). Requirement numbers fly over the page's ground, so they use ink-2, which
// keeps AA on the ground's brightest allowed pixel; ink-3 only on the opaque sheets.
export const C = { sheet: "#131417", edge: "#34363C", rule: "#2B2D32", ink: "#EDEDEA", ink2: "#A3A6AD", ink3: "#8A8E96", signal: "#3EDC8A" };

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (ctx) draw(ctx);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Cuts the text with an ellipsis until it fits; only reached past the shrink setFit allows. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  let t = text;
  while (ctx.measureText(t).width > max && t.length > 4) t = `${t.slice(0, -2).trimEnd()}…`;
  return t;
}

/** Sets the font, shrinking it (down to `floor` of the size) until the text fits. */
function setFit(ctx: CanvasRenderingContext2D, weight: number, px: number, face: string, text: string, max: number, floor = 0.85) {
  let size = px;
  ctx.font = `${weight} ${size}px ${face}`;
  while (ctx.measureText(text).width > max && size > px * floor) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${face}`;
  }
}

/** The CV sheet. Sizes follow the body size (texture px), which follows the figure's box. */
export function cvTexture(lines: LocalizedCvLine[], f: SceneFaces, L: Layout, body: number) {
  const { texW: W, texH: H } = L.cv;
  const rows = cvRows(lines.length, H);
  const gutter = W * 0.1;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = C.sheet;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.rule;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    // The gutter rule, as on a ruled pad.
    ctx.beginPath();
    ctx.moveTo(gutter - W * 0.022, H * 0.03);
    ctx.lineTo(gutter - W * 0.022, H * 0.97);
    ctx.stroke();
    ctx.textBaseline = "middle";
    const max = W - gutter - W * 0.04;
    lines.forEach((line, i) => {
      const y = rows[i];
      ctx.fillStyle = C.ink3;
      ctx.font = `400 ${Math.round(body * 0.6)}px ${f.mono}`;
      ctx.fillText(String(line.n).padStart(2, "0"), W * 0.022, y);
      const text = line.kind === "head" ? line.text.toUpperCase() : line.text;
      // A long line may shrink to 75 % before it is cut: a cut proof line reads worse than a smaller one.
      if (line.kind === "name") {
        ctx.fillStyle = C.ink;
        setFit(ctx, 300, Math.round(body * 1.45), f.display, text, max);
      } else if (line.kind === "head") {
        ctx.fillStyle = C.ink3;
        setFit(ctx, 500, Math.round(body * 0.72), f.mono, text, max);
      } else if (line.kind === "role") {
        ctx.fillStyle = C.ink;
        setFit(ctx, 600, Math.round(body * 0.96), f.text, text, max, 0.75);
      } else {
        ctx.fillStyle = C.ink2;
        setFit(ctx, 400, Math.round(body * (line.kind === "meta" ? 0.92 : 1)), f.text, text, max, 0.75);
      }
      ctx.fillText(fit(ctx, text, max), gutter, y);
    });
  });
}

/** A requirement's number and short label, beside its square. */
export function labelTexture(req: LocalizedRequirement, f: SceneFaces) {
  return canvasTexture(1024, 160, (ctx) => {
    ctx.textBaseline = "middle";
    ctx.fillStyle = C.ink2;
    ctx.font = `400 36px ${f.mono}`;
    ctx.fillText(req.n, 6, 82);
    ctx.fillStyle = C.ink;
    const max = 1024 - 120;
    setFit(ctx, 500, 66, f.text, req.label, max);
    ctx.fillText(fit(ctx, req.label, max), 110, 82);
  });
}

/** The requirement sheet's heading. */
export function headTexture(text: string, f: SceneFaces) {
  return canvasTexture(1024, 96, (ctx) => {
    ctx.textBaseline = "middle";
    ctx.fillStyle = C.ink3;
    const max = 1024 - 8;
    setFit(ctx, 500, 36, f.mono, text.toUpperCase(), max);
    ctx.fillText(fit(ctx, text.toUpperCase(), max), 4, 50);
  });
}
