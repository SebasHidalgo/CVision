import { notFound } from "next/navigation";
import { devToolsAllowed } from "@/lib/devTools";
import GlobalErrorPreview from "./components/GlobalErrorPreview";
import ThrowInBrowser from "./components/ThrowInBrowser";

/** What the forced error says; a test checks that it never reaches the page. */
const FORCED_ERROR_MESSAGE = "Forced on the server by a dev route (dev tools): this message must never reach the page.";

/**
 * Dev only (404 without dev tools): a page that fails on purpose, so the error pages can be seen and tested.
 * `/dev/error` fails under the app's shell (app/(root)/error.tsx), `/dev/crash` outside it (app/error.tsx).
 * `?at=client` throws in the browser after hydration instead of on the server (no digest, a real message that must
 * stay hidden). `/dev/crash?view=global` shows the root error page's body (app/global-error.tsx), which only a broken
 * root layout reaches.
 */
export default async function ErrorPreviewScreen({ at, view }: { at?: string; view?: string }) {
  if (!devToolsAllowed()) notFound();
  if (view === "global") return <GlobalErrorPreview />;
  if (at === "client") return <ThrowInBrowser />;
  throw new Error(FORCED_ERROR_MESSAGE);
}
