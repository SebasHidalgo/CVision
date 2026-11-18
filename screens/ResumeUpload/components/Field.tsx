import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The edge of a control: ink-2 at 55 % is the faintest edge that keeps 3:1 against both the page and the panel
 * fill (WCAG 1.4.11); `ed-line-2` is 1.6:1, enough for a surface but not for a field.
 */
export const CONTROL_EDGE = "border-ed-ink-2/55";

/** A text control on the design system: panel fill, a visible edge, 48 px tall, 16 px text (no zoom on iOS). */
export const fieldClass =
  `block w-full min-h-12 rounded-ed-field border ${CONTROL_EDGE} bg-ed-panel px-3.5 py-3 text-ed-body text-ed-ink caret-ed-ink ` +
  "placeholder:text-ed-ink-3 transition-[border-color] duration-200 ease-ed-out hover:border-ed-ink-2 focus:border-ed-ink " +
  "aria-invalid:border-ed-ink motion-reduce:transition-none";

/** The id of a field's error line, for the control's `aria-describedby`. */
export const errorIdOf = (id: string) => `${id}-error`;

/** An error in words, marked by shape rather than colour. */
export function ErrorText({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-2 text-ed-body text-ed-ink">
      <CircleAlert aria-hidden className="mt-[0.2em] size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

type FieldProps = {
  id: string;
  /** Omitted when the row's heading already labels the control. */
  label?: string;
  /** Right-aligned under the control: a counter. */
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
};

/** Label, control, then the error slot with an optional hint beside it. The control passes `aria-invalid` itself. */
export default function Field({ id, label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <label htmlFor={id} className="mb-2 block text-ed-small font-medium text-ed-ink">
          {label}
        </label>
      )}
      {children}
      <div className="mt-2 flex min-h-6 items-start justify-between gap-4">
        <div aria-live="polite" className="min-w-0">
          {error && <ErrorText id={errorIdOf(id)}>{error}</ErrorText>}
        </div>
        {hint}
      </div>
    </div>
  );
}
