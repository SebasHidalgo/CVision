import { isSoftwareRenderer } from "./gpu";

// The silk ground: a dark satin sheet in slow folds, drawn by one fragment shader on a reduced-resolution buffer.
// A .tsx file only so the copy scan (lib/i18n/hardcodedStrings.test.ts) reads the GLSL below as code, not as copy:
// every .ts module under components/ is scanned as interface text.

/** The canvas colour and the ceiling the light is mapped into (sRGB 0..255). */
export const CANVAS: readonly [number, number, number] = [12, 13, 15];
export const CEIL: readonly [number, number, number] = [58, 58, 57];
/** The frame shown when the ground may not move (reduced motion, software rendering): a composed fold, not a random instant. */
export const STILL_T = 30;
/** The same frame as an image, for when nothing can draw. */
export const STILL_URL = "/landing/silk-still.webp";
// Buffer pixels per CSS pixel: the folds are soft, so a third of the resolution is enough.
const SCALE = 0.3;

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an sRGB colour. */
export const relativeLuminance = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** The brightest relative luminance in an RGBA buffer: what text on the ground must hold AA against. */
export function maxLuminance(px: Uint8Array | Uint8ClampedArray) {
  let m = 0;
  for (let i = 0; i < px.length; i += 4) m = Math.max(m, relativeLuminance(px[i], px[i + 1], px[i + 2]));
  return m;
}

const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

// Coordinates in CSS px from the top left; the light (unbounded, >= 0) never leaves [canvas, ceiling]: a soft knee, so
// text on the open page keeps AA on the brightest pixel the ground can draw.
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform vec2 u_size;
uniform float u_t;
uniform vec3 u_bg;
uniform vec3 u_cap;
vec2 css() { vec2 f = gl_FragCoord.xy / u_res * u_size; return vec2(f.x, u_size.y - f.y); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 tone(float light) { return mix(u_bg, u_cap, 1.0 - exp(-max(light, 0.0))); }
float hgt(vec2 p, float t) {
  float h = 0.55 * sin(p.x * 1.7 + p.y * 0.8 + t * 0.32 + 1.4 * sin(p.y * 0.9 - t * 0.21));
  h += 0.38 * sin(-p.x * 0.9 + p.y * 2.0 - t * 0.26 + 1.1 * sin(p.x * 1.2 + t * 0.17));
  h += 0.18 * sin((p.x + p.y) * 3.3 + t * 0.4 + 2.2 * noise(p * 0.8 + t * 0.06));
  return h;
}
void main() {
  vec2 p = css() / 250.0;
  float t = u_t;
  p.x -= t * 0.04;
  float e = 0.01;
  float h = hgt(p, t);
  vec2 g = vec2(hgt(p + vec2(e, 0.0), t) - h, hgt(p + vec2(0.0, e), t) - h) / e;
  vec3 n = normalize(vec3(-g * 0.5, 1.0));
  vec3 L = normalize(vec3(-0.45, -0.55, 0.7));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), 30.0);
  float diff = max(dot(n, L), 0.0);
  gl_FragColor = vec4(tone(2.1 * spec + 0.16 * diff * diff), 1.0);
}`;

export type SilkEngine = {
  resize: (cssW: number, cssH: number) => void;
  draw: (t: number) => void;
  /** Frees the program and buffer; the canvas and its context stay usable. */
  dispose: () => void;
  /** Gives the GPU context back. Only for a canvas that has left the page. */
  release: () => void;
  /** A software renderer: hold one still frame instead of animating. */
  software: boolean;
};

const unit = (c: readonly number[]) => c.map((v) => v / 255) as [number, number, number];

/** Builds the engine on the canvas's (only) WebGL context; null without WebGL. Throws if the shader will not build. */
export function createSilkEngine(canvas: HTMLCanvasElement): SilkEngine | null {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  if (!gl || gl.isContextLost()) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("silk: no shader");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "silk:compile");
    return s;
  };
  const prog = gl.createProgram();
  if (!prog) throw new Error("silk: no program");
  const vs = shader(gl.VERTEX_SHADER, VERT);
  const fs = shader(gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "silk:link");
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // One triangle that covers the viewport.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  gl.uniform3fv(u("u_bg"), unit(CANVAS));
  gl.uniform3fv(u("u_cap"), unit(CEIL));
  const uT = u("u_t");

  return {
    software: isSoftwareRenderer(gl),
    resize(w, h) {
      canvas.width = Math.max(1, Math.round(w * SCALE));
      canvas.height = Math.max(1, Math.round(h * SCALE));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u("u_res"), canvas.width, canvas.height);
      gl.uniform2f(u("u_size"), w, h);
    },
    draw(t) {
      gl.uniform1f(uT, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    },
    release() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
