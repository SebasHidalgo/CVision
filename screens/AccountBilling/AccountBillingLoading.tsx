import { AccountSkeleton } from "@/components/account/AccountSkeleton";
import { AccountTabs } from "@/components/account/AccountTabs";
import { fontText } from "@/components/design-system/fonts";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

// The page's title names the plan, which is what is loading: a bar holds its place.
export default async function AccountBillingLoading() {
  const t = await getT("account");
  return (
    <div className={cn("ed-root flex-1", fontText.variable)}>
      <div className="ed-wrap pt-[clamp(40px,6vw,88px)] pb-ed-section">
        <div aria-hidden className="pb-[clamp(28px,4vw,48px)]">
          <span className="block h-[clamp(40px,5vw,64px)] w-[min(28rem,80%)] animate-pulse rounded-[3px] bg-ed-raise motion-reduce:animate-none" />
        </div>
        <AccountTabs current="billing" t={t} />
        <p role="status" className="sr-only">
          {t("loading")}
        </p>
        <AccountSkeleton sections={2} />
      </div>
    </div>
  );
}
