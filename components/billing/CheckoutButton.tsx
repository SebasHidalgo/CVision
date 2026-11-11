import ClientMessages from "@/components/i18n/ClientMessages";
import CheckoutButtonClient, { type CheckoutButtonProps } from "./CheckoutButtonClient";

/** The checkout button with its own words: any screen can render it without sending the billing namespace. */
export default function CheckoutButton(props: CheckoutButtonProps) {
  return (
    <ClientMessages ns={["billing"]}>
      <CheckoutButtonClient {...props} />
    </ClientMessages>
  );
}
