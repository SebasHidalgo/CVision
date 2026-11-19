import { Loader2 } from "lucide-react";
import { InkMark } from "@/components/interview/feedback/parts";
import { cn } from "@/lib/utils";

/**
 * What a page with no report says: a mark, a sentence, the explanation. The mark's shape carries the state (a turning
 * ring while the work runs, a beating dot for a call that may be live, an empty square for a call that produced
 * nothing, a dashed one for a report that can't be read); the sentence always says it. Ink, never the signal green.
 * No hooks: the server page and the client poller render the same line.
 */
export type StatusKind = "working" | "live" | "stopped" | "unreadable";

function Mark({ kind }: { kind: StatusKind }) {
  if (kind === "working") return <Loader2 aria-hidden className="size-[18px] text-ink motion-safe:animate-spin" />;
  if (kind === "live") return <span aria-hidden className="size-2.5 rounded-full bg-ink motion-safe:animate-pulse" />;
  return <InkMark shape={kind === "stopped" ? "empty" : "dashed"} className="size-3" />;
}

export function StatusLine({ kind, title, body, className }: { kind: StatusKind; title: string; body?: React.ReactNode; className?: string }) {
  return (
    <div data-feedback-state={kind} className={className}>
      <p className="flex items-start gap-3.5 text-[clamp(20px,2vw,24px)] leading-[1.3] font-medium tracking-[-0.01em] text-ink">
        <span aria-hidden className="flex h-lh shrink-0 items-center">
          <Mark kind={kind} />
        </span>
        <span className="min-w-0">{title}</span>
      </p>
      {body && <p className={cn("mt-4 max-w-[60ch] text-lede text-ink-2")}>{body}</p>}
    </div>
  );
}
