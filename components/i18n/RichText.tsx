import { Trans } from "react-i18next/TransWithoutContext";
import type { Namespace } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

type RichTextProps = {
  ns: Namespace;
  i18nKey: string;
  values?: Record<string, unknown>;
  /** Elements for the <0>…</0> or <name>…</name> tags in the string. */
  components?: Record<string, React.ReactElement> | React.ReactElement[];
};

/** Server components: a string with inline markup, in the request's language. */
export default async function RichText({ ns, i18nKey, values, components }: RichTextProps) {
  const i18n = await getI18n();
  const t = i18n.getFixedT(i18n.language, ns);
  return <Trans i18n={i18n} t={t} i18nKey={i18nKey as never} values={values} components={components} />;
}
