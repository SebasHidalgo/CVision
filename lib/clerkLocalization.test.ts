import { describe, expect, it } from "vitest";
import { clerkLocalization } from "./clerkLocalization";

// The forms of "usted" Clerk's es-MX leaves in its flows; the app addresses the user as "tú".
const USTED =
  /(?<!\p{L})(?:su|sus|usted|Introduzca|Ingrese|Verifique|Revise|Intente|Seleccione|Escriba|Haga|Elija|Utilice|Confirme|Agregue|Añada|Inicie|Contacte|Comuníquese|Vuelva a intentarlo|desea|Desea|tiene|Tiene|Está|Asegúrese|Espere)(?!\p{L})/u;
// Flows the app never shows (organizations, billing, API keys, waitlist).
const UNUSED = /^(?:organization|createOrganization|organizationSwitcher|organizationList|taskChooseOrganization|taskSelectOrganization|apiKeys|commerce|billing|waitlist|pricingTable|checkout|paymentMethod|plans|subscriptionDetails|statementPage|paymentAttemptPage)/;
// "en su lugar" is "instead", not a form of address.
const ALLOWED = /en su lugar/;

function strings(tree: object, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") return [[path, value] as [string, string]];
    return value && typeof value === "object" ? strings(value, path) : [];
  });
}

describe("Clerk's Spanish", () => {
  it("addresses the user as tú in every flow the app shows", () => {
    const es = clerkLocalization("es");
    expect(es).toBeDefined();
    const offenders = strings(es!).filter(([path, text]) => !UNUSED.test(path) && USTED.test(text.replace(ALLOWED, "")));
    expect(offenders).toEqual([]);
  });

  it("keeps Clerk's own English for English", () => {
    expect(clerkLocalization("en")).toBeUndefined();
  });
});
