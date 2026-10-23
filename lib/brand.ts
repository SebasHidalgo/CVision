/**
 * The product's name, in one place. The name and the domain may change
 * before launch: everything a customer reads (page titles, the wordmark,
 * the footer, the legal pages, the catalog the billing provider shows at
 * checkout, the names of the voice agents) reads from here, so a rename is
 * an edit to this file and to the environment, never a search through the
 * codebase. `lib/brand.test.ts` holds that line.
 *
 * Deliberately not renamed from here: the npm package, the repository,
 * code identifiers, the `[CVision]` log tags (an internal grep handle, not
 * copy) and environment variable names.
 *
 * Import-free, so client components and scripts can read it.
 */

export const BRAND = {
  /** The product's name, as a customer sees it. */
  name: "CVision",
  /** One line under the name: what it is, in the words the wording rule allows. */
  tagline: "Check your CV against the job. Then rehearse the interview out loud.",
  /** The page description search engines and link previews show. */
  description:
    "Paste a job post, upload your CV, and find out how well you actually fit before you apply. Then rehearse the interview out loud.",
  /**
   * Where a customer writes: the legal pages print it and the billing
   * provider's review expects it to be reachable. A placeholder until the
   * domain exists; replaced in the deploy phase.
   */
  supportEmail: "LEGAL_CONTACT_EMAIL",
  /**
   * Who sells: the owner's legal name as an individual, which the terms
   * must carry for the billing provider's domain review. A placeholder
   * until then; never invented here.
   */
  legalEntityName: "LEGAL_ENTITY_NAME",
} as const;

/** Where the environment variable for the public base URL lives; set per deployment. */
export const APP_URL_ENV = "NEXT_PUBLIC_APP_URL";

/**
 * The public base URL of this deployment, without a trailing slash: the
 * metadata base, and anything that must name the site absolutely. From
 * NEXT_PUBLIC_APP_URL; the local dev server when unset.
 */
export function appUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env[APP_URL_ENV]?.trim();
  return (raw || "http://localhost:3000").replace(/\/+$/, "");
}
