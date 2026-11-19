import { Bone } from "@/components/design-system/Bone";
import { fontText } from "@/components/design-system/fonts";
import { PageHeading } from "@/components/design-system/PageHeading";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import FormRow from "./components/FormRow";

/** A control's place: its label line and the 48 px box. */
function ControlBone({ label = true, className }: { label?: boolean; className?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-2">
      {label && <Bone className="h-3.5 w-24" />}
      <Bone className={cn("h-12 w-full rounded-field", className)} />
      <span className="block min-h-6" />
    </div>
  );
}

/**
 * The form's frame while the allowance is read: the heading and each row's words at once (they never change), bones
 * where the controls go. The rows are the form's own, so nothing moves when it lands.
 */
export default async function ResumeUploadLoading() {
  const t = await getT("upload");
  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div aria-busy="true" className="wrap pt-[clamp(32px,5vw,72px)] pb-[clamp(56px,7vw,112px)]">
        <PageHeading title={t("intro.title")} lede={t("intro.lede")} />
        <p role="status" className="sr-only">
          {t("intro.loading")}
        </p>
        <FormRow n="01" title={t("rows.role.title")} note={t("rows.role.body")} noteId="loading-role-note">
          <div className="grid gap-x-gutter md:grid-cols-2">
            <ControlBone />
            <ControlBone />
          </div>
        </FormRow>
        <FormRow n="02" title={t("rows.posting.title")} note={t("rows.posting.body")} noteId="loading-posting-note">
          <ControlBone label={false} className="h-60" />
        </FormRow>
        <FormRow n="03" title={t("rows.cv.title")} note={t("rows.cv.body")} noteId="loading-cv-note">
          <ControlBone label={false} className="h-40 rounded-surface" />
        </FormRow>
        <div className="page-grid border-t border-line-2 pt-[clamp(24px,3.5vw,40px)]">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between lg:col-[5/span_8] lg:max-w-[75ch]">
            <Bone className="h-4 w-56 max-w-full" />
            <Bone className="h-12 w-44 rounded-full sm:ml-auto" />
          </div>
        </div>
      </div>
    </div>
  );
}
