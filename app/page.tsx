import type { Viewport } from "next";
import HomeScreen from "@/screens/Home/HomeScreen";

// The landing is on the design system's dark ground.
export const viewport: Viewport = { themeColor: "#0c0d0f" };

export default function HomePage() {
  return <HomeScreen />;
}
