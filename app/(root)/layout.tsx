import { Header } from "@/components/navbar/Header";

// Every page except the landing: the app header above the page.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex flex-1 flex-col">{children}</main>
    </>
  );
}
