"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useClerk, useUser } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import { fontText } from "@/components/design-system/fonts";
import { cn } from "@/lib/utils";
import { MENU_CONTENT, MENU_ITEM, MENU_SEPARATOR } from "./menuStyles";
import { ACCOUNT_LINKS } from "./nav";
import UserAvatar, { UserIdentity } from "./UserAvatar";

/**
 * The account menu behind the avatar, from the header's desktop width (below it the same entries live in the
 * sheet). Pricing is offered to everyone: the plan is derived on the server and the client has no cheap way to
 * know it.
 */
export default function UserMenu() {
  const { user, isLoaded } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const { t } = useTranslation("common");

  if (!isLoaded || !user) {
    return (
      <span aria-hidden className="grid size-11 place-items-center">
        <span className="block size-9 rounded-full bg-ed-raise" />
      </span>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t("nav.accountMenu")}
        className="grid size-11 cursor-pointer place-items-center rounded-full transition-transform duration-200 ease-ed-out hover:scale-[1.04] data-[state=open]:scale-[1.04] motion-reduce:transition-none motion-reduce:hover:scale-100"
      >
        <UserAvatar user={user} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} className={cn(MENU_CONTENT, "w-64", fontText.variable)}>
          <DropdownMenu.Label className="px-2.5 py-2">
            <UserIdentity user={user} fallback={t("nav.yourAccount")} />
          </DropdownMenu.Label>
          <DropdownMenu.Separator className={MENU_SEPARATOR} />
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => openUserProfile()}>
            {t("nav.account")}
          </DropdownMenu.Item>
          {ACCOUNT_LINKS.map((item) => (
            <DropdownMenu.Item key={item.href} asChild className={MENU_ITEM}>
              <Link href={item.href}>{t(item.labelKey)}</Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className={MENU_SEPARATOR} />
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => void signOut({ redirectUrl: "/" })}>
            {t("nav.signOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
