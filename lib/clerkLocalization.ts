import { esMX } from "@clerk/localizations";
import type { Locale } from "@/lib/i18n/config";

/**
 * Clerk's components in the interface language. Spanish is es-MX, the package's closest to neutral
 * Latin American Spanish, with the strings it leaves in "usted" moved to "tú" for the flows this app
 * shows (sign-in, sign-up, profile). English is Clerk's default. clerkLocalization.test.ts holds it.
 */
const TU_OVERRIDES = {
  formFieldInputPlaceholder__emailAddresses: "Ingresa o pega una o más direcciones de correo electrónico, separadas por espacios o comas",
  formFieldLabel__confirmPassword: "Confirma la contraseña",
  signIn: {
    accountSwitcher: { subtitle: "Selecciona la cuenta con la que quieres continuar.", title: "Elige una cuenta" },
    emailCode: { title: "Revisa tu correo electrónico" },
    emailCodeMfa: { formTitle: "Revisa tu correo electrónico", title: "Revisa tu correo electrónico" },
    password: { title: "Ingresa tu contraseña" },
    resetPassword: { requiredMessage: "Por razones de seguridad, es necesario restablecer tu contraseña." },
    resetPasswordMfa: { detailsLabel: "Necesitamos verificar tu identidad para restablecer tu contraseña." },
    start: { actionText: "¿No tienes cuenta?" },
  },
  signUp: {
    phoneCode: { formSubtitle: "Ingresa el código de verificación enviado a tu número de teléfono." },
  },
  unstable__errors: {
    form_email_address_blocked:
      "No se admiten servicios de correo electrónico temporal. Usa tu dirección de correo electrónico habitual para crear una cuenta.",
  },
  userProfile: {
    connectedAccountPage: { formHint: "Selecciona un proveedor para conectar tu cuenta." },
    deletePage: {
      messageLine1:
        "¿Seguro que quieres eliminar tu cuenta? Es posible que se conserven algunos datos asociados. Para solicitar la eliminación completa de los datos, comunícate con soporte.",
    },
    emailAddressPage: { emailLink: { successMessage: "El correo electrónico {{identifier}} se agregó a tu cuenta." } },
    mfaPage: { formHint: "Selecciona un método para agregar." },
    passwordPage: {
      checkboxInfoText__signOutOfOtherSessions:
        "Te recomendamos cerrar la sesión en todos los demás dispositivos que hayan usado tu contraseña anterior.",
    },
  },
};

type Tree = { [key: string]: string | Tree | undefined };

function merge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] = value && typeof value === "object" && current && typeof current === "object" ? merge(current, value) : value;
  }
  return out;
}

const ES = merge(esMX as unknown as Tree, TU_OVERRIDES) as unknown as typeof esMX;

/** The `localization` prop for ClerkProvider; undefined keeps Clerk's English. */
export function clerkLocalization(locale: Locale): typeof esMX | undefined {
  return locale === "es" ? ES : undefined;
}
