"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.descriptionKey = exports.stripTrailingDigits = exports.normalize = void 0;
// Hebrew final letter forms → canonical forms
const HEBREW_FINAL_MAP = {
    'ך': 'כ',
    'ם': 'מ',
    'ן': 'נ',
    'ף': 'פ',
    'ץ': 'צ',
};
const unicodeFoldHebrewFinalForms = (s) => s.replace(/[ךםןףץ]/g, (c) => { var _a; return (_a = HEBREW_FINAL_MAP[c]) !== null && _a !== void 0 ? _a : c; });
/**
 * Normalize a description for pattern matching.
 * Unlike the original implementation this keeps interior digits so branch codes
 * and card-last-4 survive; strip only punctuation and collapse whitespace.
 */
const normalize = (raw) => {
    if (!raw)
        return '';
    let s = raw.toLowerCase().trim();
    s = unicodeFoldHebrewFinalForms(s);
    // Keep unicode letters, digits, and spaces; replace everything else with a space.
    s = s.replace(/[^\p{L}\p{N} ]+/gu, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
};
exports.normalize = normalize;
/**
 * "shufersal 507" → "shufersal"  (trailing numeric suffix stripped)
 * "7 eleven"      → "7 eleven"   (leading digit token preserved)
 * Only strips a pure-digit run at the very end of the string, and only if what
 * remains still contains at least one alphabetic token.
 */
const stripTrailingDigits = (s) => {
    const stripped = s.replace(/\s+\d+$/u, '').trim();
    if (!stripped)
        return s;
    // Require at least one letter to remain, otherwise keep as-is.
    return /\p{L}/u.test(stripped) ? stripped : s;
};
exports.stripTrailingDigits = stripTrailingDigits;
/**
 * Compose the merchantKey fallback: normalized + trailing-digits stripped.
 * Used as the last-resort key when no structured signal is available.
 */
const descriptionKey = (raw) => (0, exports.stripTrailingDigits)((0, exports.normalize)(raw));
exports.descriptionKey = descriptionKey;
