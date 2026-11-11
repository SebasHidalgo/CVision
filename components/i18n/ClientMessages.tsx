import { I18nNamespaces } from "@/components/providers/I18nProvider";
import type { Namespace } from "@/lib/i18n/config";
import { clientResources } from "@/lib/i18n/server";

type ClientMessagesProps = {
  ns: readonly Namespace[];
  children: React.ReactNode;
};

/** Server wrapper: sends a screen's namespaces to its client components, in the request's language. */
export default async function ClientMessages({ ns, children }: ClientMessagesProps) {
  const { locale, resources } = await clientResources(ns);
  return (
    <I18nNamespaces locale={locale} resources={resources}>
      {children}
    </I18nNamespaces>
  );
}
