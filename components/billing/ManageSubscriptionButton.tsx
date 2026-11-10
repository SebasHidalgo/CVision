import ClientMessages from "@/components/i18n/ClientMessages";
import ManageSubscriptionButtonClient, { type ManageSubscriptionButtonProps } from "./ManageSubscriptionButtonClient";

/** The portal button with its own words: any screen can render it without sending the billing namespace. */
export default function ManageSubscriptionButton(props: ManageSubscriptionButtonProps) {
  return (
    <ClientMessages ns={["billing"]}>
      <ManageSubscriptionButtonClient {...props} />
    </ClientMessages>
  );
}
