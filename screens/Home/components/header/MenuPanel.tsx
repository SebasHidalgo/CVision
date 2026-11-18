"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import SignInCta from "@/components/auth/SignInCta";
import { APP_LINKS, SECTION_LINKS } from "./sections";

const ITEM = "flex min-h-12 w-full items-center border-b border-ed-line bg-transparent text-left text-[17px] text-ed-ink no-underline cursor-pointer";

/** The header's menu below 961 px. */
export function MenuPanel({
  id,
  ref,
  open,
  onNavigate,
}: {
  id: string;
  ref: React.Ref<HTMLDivElement>;
  open: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation("landing");
  const { t: tc } = useTranslation("common");
  return (
    <div id={id} ref={ref} hidden={!open} className="border-t border-ed-line bg-ed-bg min-[961px]:hidden">
      <SignedOut>
        <nav aria-label={t("header.sectionsLabel")} className="ed-wrap grid pt-2 pb-4">
          {SECTION_LINKS.map((s) => (
            <a key={s.id} href={`#${s.id}`} onClick={onNavigate} className={ITEM}>
              {t(s.key)}
            </a>
          ))}
          <SignInCta>
            <button type="button" onClick={onNavigate} className={ITEM}>
              {t("header.signIn")}
            </button>
          </SignInCta>
        </nav>
      </SignedOut>
      <SignedIn>
        <nav aria-label={tc("nav.primary")} className="ed-wrap grid pt-2 pb-4">
          {APP_LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={onNavigate} className={ITEM}>
              {tc(l.key)}
            </Link>
          ))}
          <Link href="/account/billing" onClick={onNavigate} className={ITEM}>
            {tc("nav.planBilling")}
          </Link>
        </nav>
      </SignedIn>
    </div>
  );
}
