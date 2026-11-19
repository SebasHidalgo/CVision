// The header's dropdown menus (language, account). They portal into <body>, outside the header's design root, so
// each carries the surface, the face and its own focus look; `fontText.variable` is added where they render.

export const MENU_CONTENT =
  "surface z-50 p-1.5 font-text text-ink outline-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

export const MENU_ITEM =
  "relative flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-field px-2.5 text-[15px] text-ink-2 no-underline " +
  "outline-hidden select-none focus:bg-raise focus:text-ink data-[state=checked]:font-medium data-[state=checked]:text-ink " +
  // The raised ground alone is too faint a focus mark for the keyboard.
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ink focus-visible:-outline-offset-2";

export const MENU_LABEL = "cap px-2.5 pt-1.5 pb-2";

export const MENU_SEPARATOR = "-mx-1.5 my-1.5 h-px bg-line";
