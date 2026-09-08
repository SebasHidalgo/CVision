import { formatFileSize } from "@/screens/ResumeUpload/utils/format";
import { MAX_RESUME_BYTES } from "@/lib/schemas/resumeSchema";
import { Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

interface FileUploaderProps {
  onFileSelect: (file: File | null) => void;
}

export default function FileUploader({ onFileSelect }: FileUploaderProps) {
  // Held in state rather than read from dropzone's `acceptedFiles`, so the
  // preview always matches what the form actually received.
  const [file, setFile] = useState<File | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const selected = acceptedFiles[0] || null;
      setFile(selected);
      onFileSelect(selected);
    },
    [onFileSelect]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      multiple: false,
      accept: { "application/pdf": [".pdf"] },
      maxSize: MAX_RESUME_BYTES,
    });

  const rejection = fileRejections[0];
  const fileSize = file ? formatFileSize(file.size) : "0 Bytes";

  return (
    <div className="border-2 border-dashed border-border/50 rounded-lg text-center hover:border-primary/50 transition-colors">
      <div {...getRootProps()} className="w-full cursor-pointer p-6">
        <input {...getInputProps()} name="resume" id="resume" />
        {isDragActive ? (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              Drop your resume here
            </span>
          </div>
        ) : (
          <>
            {file ? (
              <div className="flex flex-col items-center gap-2 bg-muted p-3 rounded-md">
                <div className="flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/pdf.png" alt="PDF" className="h-10 w-10" />
                  <span className="text-sm font-medium text-foreground">
                    {file.name}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {fileSize}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  Click to upload or drag and drop
                </span>
                <span className="text-xs text-muted-foreground">
                  PDF only, up to {formatFileSize(MAX_RESUME_BYTES)}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Antes un archivo rechazado (no PDF o muy grande) era un no-op silencioso. */}
      {/* Rejected files are otherwise a silent no-op. */}
      {rejection && !file && (
        <p className="px-6 pb-4 text-xs text-destructive">
          {rejection.errors[0]?.code === "file-too-large"
            ? `That file is larger than ${formatFileSize(MAX_RESUME_BYTES)}.`
            : "Only PDF files are accepted."}
        </p>
      )}
    </div>
  );
}
