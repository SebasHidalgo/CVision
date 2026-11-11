import ClientMessages from "@/components/i18n/ClientMessages";
import PageIntro from "@/components/layout/PageIntro";
import { analysisQuotaView, currentUsageSummary } from "@/lib/database/usage";
import { getT } from "@/lib/i18n/server";
import UploadForm from "./components/UploadForm";

const NOTES = [
  { index: "01", key: "company" },
  { index: "02", key: "description" },
  { index: "03", key: "cv" },
] as const;

export default async function ResumeUploadScreen() {
  // What the form may promise: the Free allowance is shown, Pro's fair-use
  // cap only once it is hit. At zero the form does not let a file be picked.
  const [summary, t] = await Promise.all([currentUsageSummary(), getT("upload")]);
  const quota = analysisQuotaView(summary);

  return (
    <div className="wrap py-12 lg:py-16">
      <PageIntro
        eyebrow={t("intro.eyebrow")}
        title={t("intro.title")}
        lede={t("intro.lede")}
      />

      <div className="grid gap-12 pt-10 lg:grid-cols-12 lg:gap-16 lg:pt-14">
        <aside className="lg:col-span-4">
          <ol className="lg:sticky lg:top-28">
            {NOTES.map((note) => (
              <li
                key={note.index}
                className="grid grid-cols-[2.5rem_1fr] gap-x-4 border-t border-line py-5 last:border-b"
              >
                <span className="eyebrow pt-1 text-ink">{note.index}</span>
                <div>
                  <h2 className="font-medium text-ink">{t(`notes.${note.key}.title`)}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                    {t(`notes.${note.key}.body`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </aside>

        <div className="lg:col-span-8">
          <ClientMessages ns={["upload"]}>
            <UploadForm quota={quota} />
          </ClientMessages>
        </div>
      </div>
    </div>
  );
}
