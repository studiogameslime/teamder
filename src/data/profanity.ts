// ---------------------------------------------------------------------------
// Client-side profanity filter — FIRST LINE of defense only.
//
// This is a lightweight, best-effort guard that runs on-device before a chat
// message is sent. It is NOT the real moderation system: the actual safety net
// is report + block + admin delete (server-side), which is what App Store /
// Google Play UGC policy requires. This filter just stops the most obvious
// offensive text from ever hitting the wire, reducing report volume.
//
// The banned-word list is INTENTIONALLY CONSERVATIVE. It targets the most
// common Hebrew + English profanity/slurs and deliberately leaves out
// borderline words to avoid false positives on innocent messages. It is not,
// and is not meant to be, exhaustive — chasing completeness here only produces
// over-blocking and an arms race. Keep it small and pragmatic.
// ---------------------------------------------------------------------------

/**
 * Curated, conservative list of banned root words (lowercase, no niqqud).
 * Matching is done after normalization (see `normalize`), so list entries
 * should be the bare, collapsed form (e.g. "כוס", not "כּוּסס").
 *
 * Exported for reuse / unit testing.
 */
export const BANNED_WORDS: readonly string[] = [
  // --- Hebrew profanity / slurs (common) ---
  'זין', // crude
  'זיון',
  'תזדיין',
  'תזדייני',
  // NOTE: bare "כוס" intentionally OMITTED — it's also the innocent word
  // for "cup" (כוס מים/קפה) and over-blocked. Vulgar compounds kept below.
  'כוסאמק',
  'כוסאמא',
  'כוסעמק',
  'שרמוטה',
  'שרמוטות',
  'זונה',
  'זונות',
  'מניאק',
  'מניאקים',
  'בן זונה',
  'בנזונה',
  'מזדיין',
  'מזדיינת',
  'חרא',
  'מטומטם',
  'מפגר', // ableist slur
  'מפגרת',
  'הומו', // used as a slur in-context
  'נכה', // only as a thrown insult; conservative inclusion
  'אנס',
  'תמות',

  // --- English profanity / slurs (common) ---
  'fuck',
  'fucker',
  'fucking',
  'motherfucker',
  'shit',
  'bullshit',
  'bitch',
  'cunt',
  'asshole',
  'dickhead',
  'whore',
  'slut',
  'faggot', // slur
  'nigger', // slur
  'nigga', // slur
  'retard', // ableist slur
  'rape',
  'rapist',
];

// Niqqud (Hebrew vowel/cantillation marks) range — stripped before matching so
// "כּוּס" collapses to "כוס".
const NIQQUD = /[֑-ׇ]/g;

// Characters we treat as separators / noise: punctuation, symbols, digits used
// as letter substitutes are handled separately below.
const PUNCT = /[^א-תa-z\s]/g;

/**
 * Normalize text for matching:
 *  - lowercase
 *  - strip Hebrew niqqud
 *  - drop punctuation/symbols (keeps Hebrew letters, latin letters, spaces)
 *  - collapse runs of the same character (e.g. "fuuuuck" → "fuck",
 *    "כּוּסס" → "כוס") so simple letter-padding evasion is defeated
 *  - collapse whitespace
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(NIQQUD, '')
    .replace(PUNCT, ' ')
    .replace(/(.)\1+/g, '$1') // collapse repeated chars
    .replace(/\s+/g, ' ')
    .trim();
}

// Pre-normalize the list once at module load so each check is cheap.
const NORMALIZED_BANNED: readonly string[] = BANNED_WORDS.map((w) =>
  normalize(w)
).filter((w) => w.length > 0);

/**
 * Returns true if `text` contains any banned word.
 *
 * Matching strategy: we normalize both the input and the list, then look for
 * each banned term as a token (whitespace-delimited) OR as a substring. Pure
 * substring matching is used because Hebrew has no reliable word boundaries
 * after we collapse punctuation, and offensive words are frequently mashed
 * into longer strings. This errs slightly toward catching more — acceptable
 * for a first-line client filter where the real recourse is report/block.
 */
// A SHORT Hebrew root (≤4 letters, no latin) is too ambiguous for substring
// matching — it hides inside innocent words (בנזין⊃זין, הומור⊃הומו,
// אחראי⊃חרא, מגזין⊃זין). For these we require an EXACT token match only;
// normalization still catches padded/punctuated forms (זייןןן!→זין). Longer
// Hebrew roots + all English keep substring matching (padded/affixed evasion
// matters there and false positives are rare).
const HEB_LETTER = /[א-ת]/;
// Banned Hebrew words that are a substring of a common innocent word → only an
// EXACT token match counts (never substring). Kept separate from the ≤4-letter
// short-root rule because these are longer (5+) but still over-match.
const EXACT_TOKEN_ONLY = new Set(['זונה', 'זונות']);

function isShortHebrewRoot(w: string): boolean {
  return w.length <= 4 && HEB_LETTER.test(w) && !/[a-z]/.test(w);
}

export function containsProfanity(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const norm = normalize(text);
  if (!norm) return false;

  const tokens = norm.split(' ');

  for (const banned of NORMALIZED_BANNED) {
    if (!banned) continue;
    // Fast path: exact token hit (e.g. the message is just the word).
    if (tokens.includes(banned)) return true;
    // Multi-word banned phrases (e.g. "בן זונה") → substring on full string.
    if (banned.includes(' ')) {
      if (norm.includes(banned)) return true;
      continue;
    }
    // Short Hebrew root → exact token only (checked above) — no substring, or
    // it would over-block innocent words that merely contain the letters.
    if (isShortHebrewRoot(banned)) continue;
    // Hebrew words that are a substring of a common INNOCENT word — require an
    // exact token match (already checked above), never substring. e.g. "זונות"
    // ⊂ "מזונות" (alimony/foodstuffs), "זונה" ⊂ "מזונה". Without this the
    // innocent word was silently blocked.
    if (EXACT_TOKEN_ONLY.has(banned)) continue;
    // Longer single-word root: substring match against each token. Living
    // inside a token (not across the whole string) avoids cross-word matches
    // while still catching padded/affixed forms.
    for (const tok of tokens) {
      if (tok.includes(banned)) return true;
    }
  }
  return false;
}
