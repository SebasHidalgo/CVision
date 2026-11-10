import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Eyebrow from "@/components/layout/Eyebrow";
import { getT } from "@/lib/i18n/server";

type FeedbackUnavailableProps = {
  role: string;
  date: string;
};

/** A completed interview whose stored feedback no longer matches the schema. */
export default async function FeedbackUnavailable({ role, date }: FeedbackUnavailableProps) {
  const t = await getT("feedback");

  return (
    <article className="wrap py-10 lg:py-14">
      <header className="border-b border-line pb-10 lg:pb-12">
        <Eyebrow tick>{t("header.eyebrow", { date })}</Eyebrow>
        <p className="mt-6 text-lg text-ink-2">{t("header.kicker")}</p>
        <h1 className="display-lg mt-1 text-ink">{role}</h1>
      </header>

      <section className="py-12 lg:py-16">
        <p className="text-lg text-ink">{t("unavailable.title")}</p>
        <p className="lede mt-4 max-w-xl">{t("unavailable.body")}</p>
        <Link
          href="/interviews"
          className="link-rule mt-10 inline-flex items-center gap-2 px-2 text-sm text-ink-2"
        >
          <ArrowLeft className="size-4" />
          {t("actions.allInterviews")}
        </Link>
      </section>
    </article>
  );
}
