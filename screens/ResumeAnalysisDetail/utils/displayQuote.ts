/** A CV quote as shown: without the bullet marker it may start with. The stored quote stays verbatim. */
export function displayQuote(quote: string): string {
  return quote.replace(/^\s*(?:[•·▪◦‣∙*–—-]|\d{1,2}[.)])\s+/u, "");
}
