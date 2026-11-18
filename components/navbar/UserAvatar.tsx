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

/** The account's picture, or its initials on a raised ground. Decorative: the control around it carries the name. */
export default function UserAvatar({ user, className }: UserAvatarProps) {
  return (
    <Avatar className={cn("size-9 border border-ed-line-2", className)}>
      <AvatarImage src={user.imageUrl} alt="" />
      <AvatarFallback className="bg-ed-raise font-ed-mono text-[12px] font-medium text-ed-ink">{initialsFor(user)}</AvatarFallback>
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
      <p data-truncate="account-name" className="truncate text-[15px] font-medium text-ed-ink">
        {user.fullName ?? email ?? fallback}
      </p>
      {user.fullName && email && (
        <p data-truncate="account-email" className="mt-0.5 truncate font-ed-mono text-[12px] text-ed-ink-3">
          {email}
        </p>
      )}
    </div>
  );
}
