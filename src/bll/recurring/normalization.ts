// Hebrew final letter forms → canonical forms
const HEBREW_FINAL_MAP: Record<string, string> = {
  'ך': 'כ',
  'ם': 'מ',
  'ן': 'נ',
  'ף': 'פ',
  'ץ': 'צ',
};

const unicodeFoldHebrewFinalForms = (s: string): string =>
  s.replace(/[ךםןףץ]/g, (c) => HEBREW_FINAL_MAP[c] ?? c);

/**
 * Normalize a description for pattern matching.
 * Unlike the original implementation this keeps interior digits so branch codes
 * and card-last-4 survive; strip only punctuation and collapse whitespace.
 */
export const normalize = (raw: string | null | undefined): string => {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  s = unicodeFoldHebrewFinalForms(s);
  // Keep unicode letters, digits, and spaces; replace everything else with a space.
  s = s.replace(/[^\p{L}\p{N} ]+/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
};

/**
 * "shufersal 507" → "shufersal"  (trailing numeric suffix stripped)
 * "7 eleven"      → "7 eleven"   (leading digit token preserved)
 * Only strips a pure-digit run at the very end of the string, and only if what
 * remains still contains at least one alphabetic token.
 */
export const stripTrailingDigits = (s: string): string => {
  const stripped = s.replace(/\s+\d+$/u, '').trim();
  if (!stripped) return s;
  // Require at least one letter to remain, otherwise keep as-is.
  return /\p{L}/u.test(stripped) ? stripped : s;
};

/**
 * Compose the merchantKey fallback: normalized + trailing-digits stripped.
 * Used as the last-resort key when no structured signal is available.
 */
export const descriptionKey = (raw: string | null | undefined): string =>
  stripTrailingDigits(normalize(raw));
