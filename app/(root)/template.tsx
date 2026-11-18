// A template remounts on every navigation, so each page replays its CSS entrance
// (`data-page-enter` in globals.css), which only runs once a script marked <html>.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div data-page-enter="" className="flex flex-1 flex-col">
      {children}
    </div>
  );
}
