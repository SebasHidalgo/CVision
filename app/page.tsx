import { Header } from "@/components/navbar/Header";
import HomeScreen from "@/screens/Home/HomeScreen";

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="flex flex-1 flex-col">
        <HomeScreen />
      </main>
    </>
  );
}
