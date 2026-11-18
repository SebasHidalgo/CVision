"use client";

import { CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UploadStage } from "@/screens/ResumeUpload/utils/upload";

type FailureNoticeProps = {
  /** Where the run stopped, as the flow reported it. */
  stage: UploadStage;
  /** The error code's copy, already in the interface language. */
  message: string;
};

/**
 * A run that stopped, said where it stopped and why, beside the submit. It takes focus when it appears: the
 * progress view that held focus is gone, and this is what the reader needs next.
 */
export default function FailureNotice({ stage, message }: FailureNoticeProps) {
  const { t } = useTranslation("upload");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="ed-surface grid scroll-mt-24 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-5 py-5 focus:outline-none sm:px-6"
    >
      <CircleAlert aria-hidden className="mt-[0.15em] size-5 text-ed-ink" />
      <p className="font-semibold text-ed-ink">{t(`failure.${stage}`)}</p>
      <p className="col-start-2 max-w-[65ch] text-ed-ink-2">{message}</p>
      <p className="col-start-2 text-ed-small text-ed-ink-3">{t("failure.kept")}</p>
    </div>
  );
}
