import { Footer } from "@/components/layout/Footer";
import { SiteHeader } from "@/components/navbar/SiteHeader";

// Every page except the landing: the shell's header and footer around the page.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">{children}</main>
      <Footer />
    </>
  );
}
