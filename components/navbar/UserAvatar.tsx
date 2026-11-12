"use client";

import type { useUser } from "@clerk/nextjs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type SignedInUser = NonNullable<ReturnType<typeof useUser>["user"]>;

/** Initials from the name when Clerk has one, else the first letter of the email. */
function initialsFor(user: SignedInUser) {
  const fromName = [user.firstName, user.lastName]
    .flatMap((part) => (part ? [part.charAt(0)] : []))
    .join("");
  if (fromName) return fromName.toUpperCase();
  return (user.primaryEmailAddress?.emailAddress.charAt(0) ?? "?").toUpperCase();
}

type UserAvatarProps = {
  user: SignedInUser;
  className?: string;
};

/** The account's picture, or its initials on ink. Decorative: the control around it carries the name. */
export default function UserAvatar({ user, className }: UserAvatarProps) {
  return (
    <Avatar className={cn("size-9 border border-line-strong", className)}>
      <AvatarImage src={user.imageUrl} alt="" />
      <AvatarFallback className="bg-ink font-mono text-xs font-medium text-paper">
        {initialsFor(user)}
      </AvatarFallback>
    </Avatar>
  );
}

type UserIdentityProps = {
  user: SignedInUser;
  fallback: string;
};

/** Name over email; the email alone (or the fallback) when Clerk has no name. */
export function UserIdentity({ user, fallback }: UserIdentityProps) {
  const email = user.primaryEmailAddress?.emailAddress;
  return (
    <div className="min-w-0">
      <p data-truncate="account-name" className="truncate text-sm font-medium text-ink">{user.fullName ?? email ?? fallback}</p>
      {user.fullName && email && (
        <p data-truncate="account-email" className="mt-0.5 truncate font-mono text-[11px] text-ink-3">{email}</p>
      )}
    </div>
  );
}
