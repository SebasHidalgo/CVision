import { fontText } from "@/components/design-system/fonts";
import ClientMessages from "@/components/i18n/ClientMessages";
import { analysisQuotaView, currentUsageSummary } from "@/lib/database/usage";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { PageHeading } from "@/components/design-system/PageHeading";
import UploadForm from "./components/UploadForm";

export default async function ResumeUploadScreen() {
  // What the form may promise: the Free allowance is shown, Pro's cap only once it is hit. At zero the form does
  // not let a file be picked.
  const [summary, t] = await Promise.all([currentUsageSummary(), getT("upload")]);
  const quota = analysisQuotaView(summary);

  return (
    <div className={cn("root flex-1", fontText.variable)}>
      <div className="wrap pt-[clamp(32px,5vw,72px)] pb-[clamp(56px,7vw,112px)]">
        <PageHeading title={t("intro.title")} lede={t("intro.lede")} />
        <ClientMessages ns={["upload"]}>
          <UploadForm quota={quota} />
        </ClientMessages>
      </div>
    </div>
  );
}
