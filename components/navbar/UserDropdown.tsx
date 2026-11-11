"use client";

import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useClerkAppearance } from "@/hooks/useClerkAppearance";
import { ACCOUNT_LINKS } from "./nav";
import UserAvatar, { UserIdentity } from "./UserAvatar";

const ITEM = "px-2.5 py-2 text-ink-2 focus:text-ink";

/**
 * The account menu behind the avatar (md and up; below that the same entries live in the mobile
 * sheet). Pricing is offered to everyone: the plan is derived on the server and the client has no
 * cheap way to know it.
 */
export default function UserDropdown() {
  const { user, isLoaded } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const appearance = useClerkAppearance();
  const { t } = useTranslation("common");

  if (!isLoaded || !user) {
    return <span aria-hidden className="block size-9 rounded-full bg-paper-3" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("nav.accountMenu")}
        className="cursor-pointer rounded-full transition-transform duration-200 ease-out-expo hover:scale-[1.04] data-[state=open]:scale-[1.04]"
      >
        <UserAvatar user={user} />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={12}
        className="w-60 rounded-md border-line-strong p-1.5 shadow-float"
      >
        <DropdownMenuLabel className="px-2.5 py-2 font-normal">
          <UserIdentity user={user} fallback={t("nav.yourAccount")} />
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem className={ITEM} onSelect={() => openUserProfile({ appearance })}>
          {t("nav.account")}
        </DropdownMenuItem>
        {ACCOUNT_LINKS.map((item) => (
          <DropdownMenuItem key={item.href} asChild className={ITEM}>
            <Link href={item.href}>{t(item.labelKey)}</Link>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem className={ITEM} onSelect={() => signOut({ redirectUrl: "/" })}>
          {t("nav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
