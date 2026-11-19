"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { textLinkClass } from "@/components/design-system/Button";
import { MAX_RESUME_BYTES, MAX_RESUME_SIZE_LABEL } from "@/lib/uploadLimits";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/screens/ResumeUpload/utils/format";
import CvSheet from "./CvSheet";
import { CONTROL_EDGE, ErrorText, INVALID_EDGE } from "./Field";

/** The drop area's id: the form focuses it when the file is the only thing missing. */
export const DROPZONE_ID = "resume-drop";

const PROMPT_ID = "resume-prompt";
const REJECTED_ID = "resume-rejected";

interface FileUploaderProps {
  /**
   * The form's value, not local state: the form unmounts this while an
   * analysis runs, so after a failure local state would come back empty while
   * the form still held the file and would resubmit it.
   */
  file: File | null;
  onFileSelect: (file: File | null) => void;
  /** The heading's <label>, which names the drop area. */
  labelId: string;
  /** The row's note and the field's error, when there is one. */
  describedBy?: string;
  invalid?: boolean;
  /** No analysis left this period: a file must not be picked only to fail after. */
  disabled?: boolean;
}

/** Dropzone rejections are otherwise a silent no-op. */
function rejectionKey(code: string | undefined) {
  if (code === "file-too-large") return "file.rejected.tooLarge" as const;
  if (code === "too-many-files") return "file.rejected.tooMany" as const;
  return "file.rejected.notPdf" as const;
}

export default function FileUploader({ file, onFileSelect, labelId, describedBy, invalid = false, disabled = false }: FileUploaderProps) {
  const { t } = useTranslation("upload");
  const onDrop = useCallback((acceptedFiles: File[]) => onFileSelect(acceptedFiles[0] ?? null), [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    multiple: false,
    accept: { "application/pdf": [".pdf"] },
    maxSize: MAX_RESUME_BYTES,
    disabled,
  });

  const rejection = fileRejections[0];
  const rejected = Boolean(rejection) && !file;
  const description = [PROMPT_ID, rejected ? REJECTED_ID : null, describedBy].filter(Boolean).join(" ");

  return (
    <div>
      <div className="relative">
        <div
          {...getRootProps({ role: "button" })}
          id={DROPZONE_ID}
          aria-labelledby={labelId}
          aria-describedby={description}
          aria-disabled={disabled || undefined}
          className={cn(
            "flex min-h-40 cursor-pointer items-center rounded-ed-surface border px-5 py-7 transition-[border-color,background-color] duration-200 ease-ed-out motion-reduce:transition-none sm:px-6",
            isDragActive
              ? "border-ed-ink bg-ed-raise"
              : file
                ? cn(CONTROL_EDGE, "bg-ed-panel hover:border-ed-ink-2")
                : cn(CONTROL_EDGE, "border-dashed bg-ed-panel/50 hover:border-ed-ink-2"),
            (invalid || rejected) && !file && !isDragActive && INVALID_EDGE,
            disabled && "cursor-not-allowed opacity-50 hover:border-ed-field",
          )}
        >
          {/* Disabled too, so its label cannot open a file dialog whose pick would be ignored. */}
          <input
            {...getInputProps({ disabled })}
            name="resume"
            id="resume"
            aria-required
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          />

          {file ? (
            <div id={PROMPT_ID} className="flex w-full min-w-0 items-center gap-4 pr-20 sm:gap-5 sm:pr-24">
              <CvSheet />
              <div className="min-w-0 flex-1">
                <p data-truncate="file-name" title={file.name} className="truncate font-medium text-ed-ink">
                  {file.name}
                </p>
                <p className="ed-mono mt-1 text-[13px] text-ed-ink-3">{t("file.details", { size: formatFileSize(file.size, t) })}</p>
                <p className="mt-2 text-ed-small text-ed-ink-2">{t("file.replace")}</p>
              </div>
            </div>
          ) : (
            <div id={PROMPT_ID} className="flex w-full flex-col items-center gap-3 text-center">
              <CvSheet className={cn("transition-transform duration-200 ease-ed-out motion-reduce:transition-none", isDragActive && "-translate-y-1")} />
              <p className="font-medium text-ed-ink">{isDragActive ? t("file.dropHere") : t("file.dropOrChoose")}</p>
              <p className="ed-mono text-[13px] text-ed-ink-3">{t("file.limits", { size: MAX_RESUME_SIZE_LABEL })}</p>
            </div>
          )}
        </div>

        {/* Outside the drop area: a button inside another button is not operable by every reader. */}
        {file && (
          <button
            type="button"
            onClick={() => onFileSelect(null)}
            aria-label={t("file.removeNamed", { name: file.name })}
            className={cn(textLinkClass, "absolute top-1/2 right-4 -translate-y-1/2 sm:right-6")}
          >
            {t("file.remove")}
          </button>
        )}
      </div>

      <div aria-live="polite">
        {rejected && (
          <div className="mt-2">
            <ErrorText id={REJECTED_ID}>{t(rejectionKey(rejection?.errors[0]?.code), { size: MAX_RESUME_SIZE_LABEL })}</ErrorText>
          </div>
        )}
      </div>
    </div>
  );
}
