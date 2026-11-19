"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/components/design-system/Button";

/**
 * Who is signed in, and Clerk's own profile (email, sign-in methods, sessions) behind one button: the app stores
 * none of it, so the page reads it from the client session and hands the rest to Clerk's modal.
 */
export default function SignInPanel() {
  const { t } = useTranslation("account");
  const { user, isLoaded } = useUser();
  const { openUserProfile } = useClerk();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <div className="grid gap-5">
      <p className="max-w-[62ch] text-ed-body text-ed-ink-2">{t("overview.signIn.body")}</p>
      <p className="grid gap-1" data-signed-in-as>
        <span className="text-ed-small text-ed-ink-2">{t("overview.signIn.signedInAs")}</span>
        {isLoaded ? (
          <span className="text-ed-body font-medium text-ed-ink [overflow-wrap:anywhere]">{email ?? "—"}</span>
        ) : (
          <span aria-hidden className="block h-5 w-56 max-w-full animate-pulse rounded-[3px] bg-ed-raise motion-reduce:animate-none" />
        )}
      </p>
      <div>
        <button type="button" onClick={() => openUserProfile()} className={buttonClass({ variant: "ghost", size: "sm" })}>
          {t("overview.signIn.open")}
        </button>
      </div>
    </div>
  );
}
