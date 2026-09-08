"use client";

import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PRIMARY_NAV } from "./nav";

/** Initials from the name when Clerk has one, else the first letter of the email. */
function initialsFor(user: {
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
}) {
  const fromName = [user.firstName, user.lastName]
    .flatMap((part) => (part ? [part.charAt(0)] : []))
    .join("");
  if (fromName) return fromName.toUpperCase();
  return (user.primaryEmailAddress?.emailAddress.charAt(0) ?? "?").toUpperCase();
}

export default function UserDropdown() {
  const { user, isLoaded } = useUser();
  const { openUserProfile, signOut } = useClerk();

  if (!isLoaded || !user) {
    return <span aria-hidden className="size-9 rounded-full bg-paper-3" />;
  }

  const email = user.primaryEmailAddress?.emailAddress;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="rounded-full transition-transform duration-200 ease-out-expo hover:scale-[1.04] data-[state=open]:scale-[1.04]"
      >
        <Avatar className="size-9 border border-line-strong">
          <AvatarImage src={user.imageUrl} alt="" />
          <AvatarFallback className="bg-ink font-mono text-xs font-medium text-paper">
            {initialsFor(user)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-60 rounded-md border-line-strong p-1.5 shadow-float"
      >
        <DropdownMenuLabel className="px-2.5 py-2 font-normal">
          <p className="truncate text-sm font-medium text-ink">
            {user.fullName ?? email ?? "Your account"}
          </p>
          {user.fullName && email && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3">
              {email}
            </p>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Primary navigation lives here below the md breakpoint. */}
        <div className="md:hidden">
          {PRIMARY_NAV.map((item) => (
            <DropdownMenuItem key={item.href} asChild className="px-2.5 py-2">
              <Link href={item.href}>{item.label}</Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </div>

        <DropdownMenuItem
          className="px-2.5 py-2"
          onSelect={() => openUserProfile()}
        >
          Profile &amp; security
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="px-2.5 py-2 text-ink-2"
          onSelect={() => signOut({ redirectUrl: "/" })}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
