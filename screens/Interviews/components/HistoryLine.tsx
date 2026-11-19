import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { PLANS } from "@/lib/plans";

const LIMIT = PLANS.FREE.historyLimit ?? 0;

/** The one line under the list when the Free history rule hides interviews. Pro reveals them; nothing was deleted. */
export async function HistoryLine({ hidden }: { hidden: number }) {
  if (hidden === 0) return null;
  const t = await getT("billing");
  return (
    <p data-history-line className="mt-6 max-w-[75ch] text-ed-body text-ed-ink-2">
      {t("history.line.interviews", { count: hidden, limit: LIMIT })}{" "}
      <Link href="/pricing" className="inline-flex min-h-11 items-center text-ed-ink underline decoration-ed-ink-3 underline-offset-4 hover:decoration-ed-ink">
        {t("history.seePro")}
      </Link>
    </p>
  );
}
