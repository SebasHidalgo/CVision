import Link from "next/link";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";

type AccountPage = "account" | "billing";

const PAGES: readonly { page: AccountPage; href: string }[] = [
  { page: "account", href: "/account" },
  { page: "billing", href: "/account/billing" },
];

/** The two account pages as sibling links on a rule; the current one carries an ink bar on the rule itself. */
export function AccountTabs({ current, t }: { current: AccountPage; t: TFunction<"account"> }) {
  return (
    <nav aria-label={t("tabs.label")} className="border-b border-line-2">
      <ul className="flex gap-x-7">
        {PAGES.map(({ page, href }) => {
          const active = page === current;
          return (
            <li key={page}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-12 items-center border-b-2 text-[15.5px] no-underline transition-colors duration-200",
                  active ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:border-line-2 hover:text-ink",
                )}
              >
                {t(`tabs.${page}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
