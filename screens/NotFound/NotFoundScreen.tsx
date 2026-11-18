import { ButtonLink } from "@/components/design-system/Button";
import { fontText } from "@/components/design-system/fonts";
import { StatusMark } from "@/components/design-system/StatusMark";
import { Footer } from "@/components/layout/Footer";
import { SiteHeader } from "@/components/navbar/SiteHeader";
import { getT } from "@/lib/i18n/server";

/**
 * The 404: unknown URLs and every notFound(), app pages included. The boundary sits in the root layout, above the
 * app's own layout, so the screen brings the shell's header and footer itself.
 */
export default async function NotFoundScreen() {
  const t = await getT("notFound");
  return (
    <div className={`ed-root ${fontText.variable} flex min-h-dvh flex-1 flex-col`}>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <section
          aria-labelledby="not-found-title"
          className="ed-wrap ed-grid w-full flex-1 content-center gap-y-5 py-[clamp(64px,10vw,128px)]"
        >
          <h1 id="not-found-title" className="ed-display text-ed-h2 text-balance lg:col-span-8">
            {t("title")}
          </h1>
          <p className="max-w-[60ch] text-ed-lede text-ed-ink-2 lg:col-span-7">{t("body")}</p>
          {/* The status written next to its mark, as on a requirement the CV doesn't show. */}
          <p className="ed-mono flex items-center gap-2.5 text-ed-micro text-ed-ink-2">
            <StatusMark status="notshown" />
            404 · {t("status")}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <ButtonLink href="/">{t("home")}</ButtonLink>
            <ButtonLink href="/resume/analyses" variant="ghost">
              {t("analyses")}
            </ButtonLink>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
