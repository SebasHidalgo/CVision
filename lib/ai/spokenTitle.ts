/** A job title as it is said aloud: inclusive written forms ("Desarrollador/a", "(m/f)") keep their first form. */

/** Endings a posting adds after a slash or in a parenthesis to cover both genders. */
const GENDER_ENDING = "(?:oras|ora|ras|ra|nas|na|as|a|os|o|es|e|x|innen|in)";

const IN_PARENTHESIS = new RegExp(`(\\p{L}{2,})\\(${GENDER_ENDING}\\)`, "giu");
const AFTER_SLASH = new RegExp(`(\\p{L}{2,})/${GENDER_ENDING}(?![\\p{L}\\p{N}])`, "giu");
/** "(m/f)", "(h/m/x)", "[m/w/d]": a tag, not a word. */
const GENDER_TAG = /\s*[([]\s*\p{L}(?:\s*[/|]\s*\p{L}){1,3}\s*[)\]]/gu;
const WORD_PAIR = /(\p{L}{4,})\/(\p{L}{4,})/gu;

function sharedPrefix(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length].toLowerCase() === b[length].toLowerCase()) length += 1;
  return length;
}

/** "Desarrollador/Desarrolladora" is one word twice; "Frontend/Backend" is two words. */
function sameWord(first: string, second: string): boolean {
  const shorter = Math.min(first.length, second.length);
  return Math.abs(first.length - second.length) <= 2 && sharedPrefix(first, second) >= Math.max(3, shorter - 2);
}

export function spokenTitle(title: string): string {
  const spoken = title
    .replace(GENDER_TAG, "")
    .replace(IN_PARENTHESIS, "$1")
    .replace(AFTER_SLASH, "$1")
    .replace(WORD_PAIR, (whole, first: string, second: string) => (sameWord(first, second) ? first : whole))
    .replace(/\s+/g, " ")
    .trim();
  // A title that was nothing but a tag stays as written.
  return spoken || title.replace(/\s+/g, " ").trim();
}
