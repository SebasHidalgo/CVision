import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/design-system/Button";
import { getT } from "@/lib/i18n/server";
import { PLANS } from "@/lib/plans";

const LIMIT = PLANS.FREE.historyLimit ?? 0;

/**
 * What a hidden analysis's page shows instead of its content (the Free history rule), with the billing namespace's
 * words; the analyses list is where it can still be deleted.
 */
export default async function HiddenAnalysis({ title }: { title: string }) {
  const t = await getT("billing");
  return (
    <section aria-labelledby="hidden-title" className="max-w-[60ch]">
      <h1 id="hidden-title" className="display text-[clamp(36px,4.4vw,60px)] leading-[1.04] tracking-[-0.03em] text-balance">
        {title}
      </h1>
      <p className="mt-6 text-lede text-ink-2">{t("history.body", { limit: LIMIT })}</p>
      <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
        <ButtonLink href="/pricing">
          {t("history.seePro")}
          <ArrowRight aria-hidden className="size-4" />
        </ButtonLink>
        <ButtonLink href="/resume/analyses" variant="ghost">
          {t("history.back")}
        </ButtonLink>
      </div>
    </section>
  );
}
