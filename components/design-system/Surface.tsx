import { cn } from "@/lib/utils";

type SurfaceProps<T extends React.ElementType> = {
  as?: T;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

/** A solid panel with its edge. Content sits on one of these, never on the moving ground. */
export function Surface<T extends React.ElementType = "div">({ as, className, children, ...rest }: SurfaceProps<T>) {
  const Tag = (as ?? "div") as React.ElementType;
  return (
    <Tag className={cn("ed-surface", className)} {...rest}>
      {children}
    </Tag>
  );
}
