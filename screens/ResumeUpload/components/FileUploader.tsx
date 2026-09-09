"use client";

import { Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { MAX_RESUME_BYTES } from "@/lib/schemas/resumeSchema";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/screens/ResumeUpload/utils/format";

interface FileUploaderProps {
  onFileSelect: (file: File | null) => void;
  invalid?: boolean;
}

/** A small sheet with a folded corner: the CV as an object. */
function Sheet() {
  return (
    <span
      aria-hidden
      className="relative block h-14 w-11 shrink-0 border border-line-strong bg-sheet p-2"
    >
      <span className="block h-1 w-1/2 bg-ink" />
      <span className="mt-1.5 block h-px w-full bg-line-strong" />
      <span className="mt-1 block h-px w-4/5 bg-line-strong" />
      <span className="mt-1 block h-px w-full bg-line-strong" />
      <span className="absolute top-0 right-0 size-3 bg-paper-3 [clip-path:polygon(0_0,100%_100%,0_100%)]" />
    </span>
  );
}

export default function FileUploader({
  onFileSelect,
  invalid = false,
}: FileUploaderProps) {
  // Held in state rather than read from dropzone's `acceptedFiles`, so the
  // preview always matches what the form actually received.
  const [file, setFile] = useState<File | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const selected = acceptedFiles[0] || null;
      setFile(selected);
      onFileSelect(selected);
    },
    [onFileSelect],
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      multiple: false,
      accept: { "application/pdf": [".pdf"] },
      maxSize: MAX_RESUME_BYTES,
    });

  const clear = (event: React.MouseEvent) => {
    // The whole slot opens the file dialog; removing must not.
    event.stopPropagation();
    setFile(null);
    onFileSelect(null);
  };

  const rejection = fileRejections[0];

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          "relative flex min-h-[9.5rem] cursor-pointer items-center justify-center border border-dashed px-6 py-8 transition-colors duration-200 ease-out-expo",
          isDragActive
            ? "border-signal bg-signal-soft/50"
            : file
              ? "border-line-strong bg-paper-2/70"
              : "border-line-strong hover:border-ink",
          invalid && !file && "border-signal",
        )}
      >
        <input {...getInputProps()} name="resume" id="resume" />

        {file ? (
          <div className="flex w-full items-center gap-5">
            <Sheet />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{file.name}</p>
              <p className="eyebrow mt-1.5">
                {formatFileSize(file.size)} · PDF
              </p>
            </div>
            <button
              type="button"
              onClick={clear}
              className="link-rule shrink-0 cursor-pointer text-sm text-ink-2"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <Upload
              className={cn(
                "size-6 transition-colors duration-200",
                isDragActive ? "text-signal" : "text-ink-3",
              )}
            />
            <p className="font-medium text-ink">
              {isDragActive
                ? "Drop it here"
                : "Drop your CV here, or click to choose it"}
            </p>
            <p className="eyebrow">
              PDF · up to {formatFileSize(MAX_RESUME_BYTES)}
            </p>
          </div>
        )}
      </div>

      {/* Rejected files are otherwise a silent no-op. */}
      {rejection && !file && (
        <p className="mt-2 flex items-center gap-2 text-sm text-signal">
          <span aria-hidden className="size-1.5 shrink-0 bg-signal" />
          {rejection.errors[0]?.code === "file-too-large"
            ? `That file is larger than ${formatFileSize(MAX_RESUME_BYTES)}.`
            : "Only PDF files are accepted."}
        </p>
      )}
    </div>
  );
}
