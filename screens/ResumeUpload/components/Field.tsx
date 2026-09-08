import { cn } from "@/lib/utils";

type FieldProps = {
  id: string;
  label: string;
  /** Right-aligned label-voice note: a counter, a format. */
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
};

/** Label, control and error slot. The control itself passes `aria-invalid`. */
export default function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("group/field", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <label
          htmlFor={id}
          className="eyebrow transition-colors duration-200 group-focus-within/field:text-ink"
        >
          {label}
        </label>
        {hint && <span className="eyebrow tabular">{hint}</span>}
      </div>

      {children}

      <div aria-live="polite" className="mt-2 min-h-5">
        {error && (
          <p className="flex items-center gap-2 text-sm text-signal animate-in fade-in slide-in-from-top-1 duration-200">
            <span aria-hidden className="size-1.5 shrink-0 bg-signal" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
