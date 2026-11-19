/**
 * The billing buttons sit on pages in and out of `.root`: the system's focus ring is stated on the button itself,
 * and a disabled pill holds still.
 */
export const BILLING_BUTTON = [
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[3px] focus-visible:outline-ink",
  "cursor-pointer disabled:cursor-not-allowed disabled:opacity-75 disabled:hover:translate-y-0 disabled:active:scale-100",
].join(" ");
