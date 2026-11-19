import { AccountSkeleton } from "@/components/account/AccountSkeleton";
import { AccountTabs } from "@/components/account/AccountTabs";
import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export default async function AccountLoading() {
  const t = await getT("account");
  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div className="wrap pt-[clamp(40px,6vw,88px)] pb-section">
        <PageHeading title={t("meta.accountTitle")} />
        <AccountTabs current="account" t={t} />
        <p role="status" className="sr-only">
          {t("loading")}
        </p>
        <AccountSkeleton sections={3} />
      </div>
    </div>
  );
}
