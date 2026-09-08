import PageTransition from "@/components/motion/PageTransition";

// A template remounts on every navigation, which is what gives each page
// its entrance.
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
