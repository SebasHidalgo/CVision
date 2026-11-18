// What the device can draw. No three.js and no React: the hero and the ground both read it.

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** Whether a WebGL context runs on a software renderer (no GPU): too slow to animate. */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
  return SOFTWARE_RENDERER.test(renderer);
}

/**
 * Whether the browser gives WebGL on a hardware GPU. Asks a throwaway canvas that never enters the page, so giving
 * its context back at once is safe (and keeps the browser's context budget for the canvases that draw).
 */
export function hasHardwareWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    const software = isSoftwareRenderer(gl);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return !software;
  } catch {
    return false;
  }
}
