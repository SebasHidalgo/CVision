import { useTheme } from "next-themes";
import { clerkAppearance } from "@/lib/clerkAppearance";

/** Appearance for Clerk modals opened from the client, following the theme. */
export function useClerkAppearance() {
  const { resolvedTheme } = useTheme();
  return clerkAppearance(resolvedTheme === "dark" ? "dark" : "light");
}
