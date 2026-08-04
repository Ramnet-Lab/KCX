/**
 * Normalising an item name into a lookup key.
 *
 * The bazaar's item catalogue is partly crowd-written: a seller who can't find their item in
 * the list types its in-game inventory name, and that becomes an entry other sellers pick
 * from. Without normalisation the list fills up with near-duplicates — "P4-AR", "p4 ar",
 * "Behring P4‑AR " — and then nothing finds anything, because the search term and the stored
 * name differ by a character nobody can see.
 *
 * So the KEY is what uniqueness and lookup run on, and the display name is only ever
 * displayed. The same function runs on the client and the server: if the two disagreed, the
 * form would say "already in the list" for something the server then stored a second copy of.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;
const NOT_ALPHANUMERIC = /[^a-z0-9]+/g;

/**
 * Fold a name to its comparison key.
 *
 * Two steps, and the order matters:
 *
 *  1. Unicode NFKD, then drop the combining marks it leaves behind. This is what turns "Ǻ"
 *     into "A" rather than into nothing — a seller on a phone keyboard will not reproduce
 *     the accent, and without the decomposition step the accented letter would simply be
 *     deleted by step 2 and the two spellings would key differently.
 *  2. Lowercase, and collapse every run of non-alphanumerics to a single space. This is what
 *     makes "P4-AR", "P4 AR", "p4_ar" and a copy-paste carrying a non-breaking space all one
 *     key, without needing a list of the punctuation people actually type.
 *
 * Returns "" for input with no letters or digits at all. Callers must treat that as "not a
 * name" rather than as a key — otherwise every junk entry collides into a single row.
 */
export function itemNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NOT_ALPHANUMERIC, " ")
    .trim();
}

/** True when a name reduces to something usable as a key. */
export function isUsableItemName(name: string): boolean {
  return itemNameKey(name).length >= 2;
}

export const ITEM_NAME_MAX = 160;
