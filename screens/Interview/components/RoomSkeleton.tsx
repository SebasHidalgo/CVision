import { Bone } from "@/components/design-system/Bone";

/**
 * The room's frame before it has a call to show: the same header, the presence panel beside the transcript and the
 * control bar, as bones. The route's loading state and the room's chunk loading draw this same frame, so the room
 * appears in place instead of jumping. No hooks: the caller passes the status line's words.
 */
export function RoomSkeleton({ status }: { status: string }) {
  return (
    <div aria-busy="true" className="flex flex-1 flex-col lg:h-[calc(100dvh-4rem-1px)] lg:flex-none">
      <div className="ed-wrap flex min-h-0 w-full flex-1 flex-col pt-4 sm:pt-6">
        <p role="status" className="sr-only">
          {status}
        </p>
        <div className="flex items-end justify-between gap-5 border-b border-ed-line pb-4 lg:pb-5">
          <div className="grid min-w-0 flex-1 gap-2.5">
            <Bone className="h-8 w-3/5 max-w-md" />
            <Bone className="h-4 w-36" />
            <Bone className="h-3 w-20" />
          </div>
          <div className="grid shrink-0 justify-items-end gap-2">
            <Bone className="h-3 w-16" />
            <Bone className="h-8 w-24" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 py-4 lg:grid lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)] lg:gap-6 lg:py-6">
          <div className="ed-surface flex shrink-0 flex-col p-5 lg:col-span-5 lg:self-start lg:p-6">
            <Bone className="h-8 w-1/2" />
            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 lg:mt-6 lg:grid-cols-1 lg:gap-y-5">
              {[0, 1].map((channel) => (
                <div key={channel} className="grid gap-2.5">
                  <Bone className="h-3 w-24" />
                  <Bone className="h-9 w-full lg:h-11" />
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-5 border-t border-ed-line pt-5 lg:mt-6">
              <div className="grid gap-2">
                <Bone className="h-3 w-16" />
                <Bone className="h-4 w-32" />
              </div>
              <div className="grid gap-2">
                <Bone className="h-3 w-20" />
                <Bone className="h-11 w-full rounded-ed-field" />
              </div>
            </div>
          </div>

          <div className="ed-surface flex h-[clamp(14rem,42dvh,22rem)] min-h-0 flex-col lg:col-span-7 lg:h-auto">
            <div className="flex items-baseline justify-between gap-4 border-b border-ed-line px-5 py-3.5 lg:px-7">
              <Bone className="h-3 w-24" />
            </div>
            <div className="grid content-start gap-3 px-5 py-5 lg:px-7">
              <Bone className="h-4 w-4/5 max-w-[44ch]" />
              <Bone className="h-4 w-3/5 max-w-[36ch]" />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 -mx-ed-pad flex flex-col gap-3 border-t border-ed-line bg-ed-bg px-ed-pad py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <Bone className="h-4 w-64 max-w-full" />
          <Bone className="h-12 w-48 rounded-full" />
        </div>
      </div>
    </div>
  );
}
