import { formatFileSize } from "@/utils/format";
import { Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

interface FileUploaderProps {
  onFileSelect?: (file: File | null) => void;
}

export default function FileUploader({ onFileSelect }: FileUploaderProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0] || null;
      onFileSelect?.(file);
    },
    [onFileSelect]
  );

  const { getRootProps, getInputProps, isDragActive, acceptedFiles } =
    useDropzone({
      onDrop,
      multiple: false,
      accept: {
        "application/pdf": [".pdf"],
      },
      maxSize: 20 * 1024 * 1024,
    });

  const file = acceptedFiles[0] || null;

  const fileSize = file ? formatFileSize(file.size) : "0 Bytes";

  return (
    <div className="border-2 border-dashed border-border/50 rounded-lg text-center hover:border-primary/50 transition-colors">
      <div {...getRootProps()} className="w-full cursor-pointer p-6">
        <input
          {...getInputProps()}
          name="resume-upload"
          id="resume-upload"
          required
        />
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
                  PDF files only
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
