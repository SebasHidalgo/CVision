"use client";

import type { useUser } from "@clerk/nextjs";
import * as Avatar from "@radix-ui/react-avatar";
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

/** The account's picture, or its initials on a raised ground. Decorative: the control around it carries the name. */
export default function UserAvatar({ user, className }: UserAvatarProps) {
  return (
    <Avatar.Root className={cn("relative flex size-9 shrink-0 overflow-hidden rounded-full border border-line-2", className)}>
      <Avatar.Image src={user.imageUrl} alt="" className="aspect-square size-full" />
      <Avatar.Fallback className="flex size-full items-center justify-center rounded-full bg-raise font-mono text-[12px] font-medium text-ink">
        {initialsFor(user)}
      </Avatar.Fallback>
    </Avatar.Root>
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
      <p data-truncate="account-name" className="truncate text-[15px] font-medium text-ink">
        {user.fullName ?? email ?? fallback}
      </p>
      {user.fullName && email && (
        <p data-truncate="account-email" className="mt-0.5 truncate font-mono text-[12px] text-ink-3">
          {email}
        </p>
      )}
    </div>
  );
}
