"use client";

import { CircleAlert } from "lucide-react";
import { useEffect, useId, useRef } from "react";
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
 * progress view that held focus is gone, and this is what the reader needs next. Focus is what announces it
 * (its name, then its description), so it is not a live region too: an alert that also takes focus is read
 * twice.
 */
export default function FailureNotice({ stage, message }: FailureNoticeProps) {
  const { t } = useTranslation("upload");
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const messageId = `${id}-message`;
  const keptId = `${id}-kept`;

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      role="group"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={`${messageId} ${keptId}`}
      data-failure-notice
      className="surface grid scroll-mt-24 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-5 py-5 focus:outline-none sm:px-6"
    >
      <CircleAlert aria-hidden className="mt-[0.15em] size-5 text-danger-text" />
      <p id={titleId} className="font-semibold text-ink">
        {t(`failure.${stage}`)}
      </p>
      <p id={messageId} className="col-start-2 max-w-[65ch] text-ink-2">
        {message}
      </p>
      <p id={keptId} className="col-start-2 text-small text-ink-3">
        {t("failure.kept")}
      </p>
    </div>
  );
}
