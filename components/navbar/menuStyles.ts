// The header's dropdown menus (language, account). They portal into <body>, outside the header's design root, so
// each carries the surface, the face and its own focus look; `fontText.variable` is added where they render.

export const MENU_CONTENT =
  "ed-surface z-50 p-1.5 font-ed-text text-ed-ink outline-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

export const MENU_ITEM =
  "relative flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-ed-field px-2.5 text-[15px] text-ed-ink-2 no-underline " +
  "outline-hidden select-none focus:bg-ed-raise focus:text-ed-ink data-[state=checked]:font-medium data-[state=checked]:text-ed-ink " +
  // The raised ground alone is too faint a focus mark for the keyboard.
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ed-ink focus-visible:-outline-offset-2";

export const MENU_LABEL = "ed-cap px-2.5 pt-1.5 pb-2";

export const MENU_SEPARATOR = "-mx-1.5 my-1.5 h-px bg-ed-line";
