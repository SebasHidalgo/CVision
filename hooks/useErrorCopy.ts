"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { actionErrorCopy, resetDateCopy } from "@/lib/error/actionErrorCopy";
import type { ErrorCode, ErrorMeta } from "@/lib/error/errors";
import { useLocale } from "./useLocale";

/** Client components: the copy for an action's error code, in the interface language. */
export function useErrorCopy() {
  const { t } = useTranslation("errors");
  const locale = useLocale();
  return useCallback((code: ErrorCode, meta?: ErrorMeta) => actionErrorCopy(t, locale, code, meta), [t, locale]);
}

/** Client components: "Nov 1" / "1 nov" for a quota's reset. */
export function useResetDate() {
  const locale = useLocale();
  return useCallback((resetsAt: string) => resetDateCopy(resetsAt, locale), [locale]);
}
