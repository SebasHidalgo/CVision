// The inline script the root layout runs before first paint on every full page load. Plain string: no imports.

/** The loader's hard cap from the script's start: past it the page shows with whatever is ready. */
export const LOADER_CAP_MS = 2500;
/** Fired once the landing shows (after the loader, or at once without one). */
export const REVEALED_EVENT = "cvision:revealed";

// Runs before first paint. Marks JavaScript as present (CSS entrances key on it, so without JavaScript nothing is
// hidden). On a full load of the landing only, raises the loader and arms the cap. "travel" = the loader is handing
// over; the cap lets it finish.
export const BOOT_SCRIPT = `(function(){var d=document.documentElement;d.setAttribute("data-js","");if(location.pathname!=="/")return;d.setAttribute("data-loading","");d.style.overflow="hidden";d.style.scrollbarGutter="stable";window.__cvReveal=function(){if(!d.hasAttribute("data-loading"))return;d.removeAttribute("data-loading");d.style.overflow="";d.style.scrollbarGutter="";try{performance.mark("${REVEALED_EVENT}")}catch(e){}window.dispatchEvent(new Event("${REVEALED_EVENT}"))};setTimeout(function(){if(d.getAttribute("data-loading")!=="travel")window.__cvReveal()},${LOADER_CAP_MS})})();`;

declare global {
  interface Window {
    __cvReveal?: () => void;
  }
}

/** Shows the page now (idempotent). */
export function reveal() {
  window.__cvReveal?.();
}

/** Whether the loader is up: false without JavaScript's boot script, after the reveal, or off the landing. */
export function isLoading(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-loading");
}
