import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type EmptyStateProps = {
  title: string;
  body: string;
  action: { href: string; label: string };
};

/** A blank sheet, a plain sentence and one way forward. */
export default function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <section className="grid gap-10 py-16 md:grid-cols-[auto_1fr] md:items-center md:gap-16 md:py-24">
      <div
        aria-hidden
        className="relative mx-auto aspect-[3/4] w-32 border border-dashed border-line-strong p-4 md:w-40"
      >
        <span className="block h-2 w-1/2 bg-paper-3" />
        <span className="mt-3 block h-px w-full bg-line" />
        <span className="mt-2 block h-px w-4/5 bg-line" />
        <span className="mt-2 block h-px w-full bg-line" />
        <span className="mt-6 block h-px w-3/5 bg-line" />
        <span className="mt-2 block h-px w-full bg-line" />
        <span className="absolute right-3 bottom-3 size-2 bg-signal" />
      </div>

      <div className="max-w-md text-center md:text-left">
        <h2 className="display-md text-ink">{title}</h2>
        <p className="lede mt-4">{body}</p>
        <Button asChild size="lg" className="mt-8 h-12 px-6 text-base">
          <Link href={action.href}>
            {action.label}
            <ArrowUpRight className="size-5" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
