import { Bone } from "@/components/design-system/Bone";
import { getT } from "@/lib/i18n/server";
import { FeedbackPage } from "./components/FeedbackPage";

const SECTIONS = [0, 1];

/**
 * The report's frame while the page reads the interview (and, for one that just ended, settles it): the head with
 * the score's place, then two sections with their rail. A waiting or failed state shares the same head.
 */
export default async function InterviewFeedbackLoading() {
  const t = await getT("feedback");
  return (
    <FeedbackPage>
      <div aria-busy="true">
        <p role="status" className="sr-only">
          {t("header.loading")}
        </p>
        <div className="page-grid gap-y-7 border-b border-line-2 pb-[clamp(32px,4.5vw,56px)] lg:items-end">
          <div className="grid gap-3 lg:col-[1/span_8]">
            <Bone className="h-3 w-48" />
            <Bone className="mt-3 h-5 w-36" />
            <Bone className="h-[clamp(34px,4.4vw,64px)] w-4/5 max-w-2xl" />
            <Bone className="mt-1 h-4 w-52" />
            <Bone className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex items-end gap-3.5 lg:col-[9/span_4] lg:justify-self-end">
            <Bone className="h-[clamp(64px,7vw,104px)] w-28" />
            <div className="grid gap-2 pb-1.5">
              <Bone className="h-3 w-16" />
              <Bone className="h-4 w-20" />
            </div>
          </div>
          <div className="grid gap-2.5">
            <Bone className="h-3 w-20" />
            <Bone className="h-1.5 w-full" />
          </div>
        </div>
        {SECTIONS.map((section) => (
          <div key={section} className="page-grid gap-y-7 border-b border-line py-[clamp(40px,5.5vw,72px)]">
            <div className="grid content-start gap-3 lg:col-[1/span_4]">
              <Bone className="h-3 w-28" />
              <Bone className="h-7 w-4/5 max-w-[24ch]" />
            </div>
            <div className="grid content-start gap-3 lg:col-[5/span_8]">
              <Bone className="h-4 w-full max-w-[68ch]" />
              <Bone className="h-4 w-11/12 max-w-[64ch]" />
              <Bone className="h-4 w-3/5" />
              <Bone className="mt-3 h-16 w-full max-w-[68ch] rounded-r-[4px]" />
            </div>
          </div>
        ))}
      </div>
    </FeedbackPage>
  );
}
