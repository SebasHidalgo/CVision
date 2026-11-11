import type { TFunction } from "i18next";

export type FileSizeUnit = "bytes" | "kb" | "mb" | "gb" | "tb";

const UNITS: FileSizeUnit[] = ["bytes", "kb", "mb", "gb", "tb"];

/** The size in the largest unit that keeps it at 1 or more, to two decimals. */
export function fileSize(bytes: number): { value: number; unit: FileSizeUnit } {
  if (bytes <= 0) return { value: 0, unit: "bytes" };
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), UNITS.length - 1);
  return { value: parseFloat((bytes / Math.pow(k, i)).toFixed(2)), unit: UNITS[i] };
}

/** "1.5 MB", "0 Bytes": the unit's word comes from the upload namespace. */
export function formatFileSize(bytes: number, t: TFunction<"upload">): string {
  const { value, unit } = fileSize(bytes);
  return t(`size.${unit}`, { value });
}
