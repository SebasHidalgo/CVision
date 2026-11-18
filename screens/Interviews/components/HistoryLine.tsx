import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { PLANS } from "@/lib/plans";

const LIMIT = PLANS.FREE.historyLimit ?? 0;

/** The one line under the list when the Free history rule hides interviews. Pro reveals them; nothing was deleted. */
export async function HistoryLine({ hidden }: { hidden: number }) {
  if (hidden === 0) return null;
  const t = await getT("billing");
  return (
    <p className="mt-6 text-sm text-ink-2">
      {t("history.line.interviews", { count: hidden, limit: LIMIT })}{" "}
      <Link href="/pricing" className="link-rule font-medium text-ink">
        {t("history.seePro")}
      </Link>
    </p>
  );
}
