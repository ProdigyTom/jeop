export type MatchType =
  | "exact"
  | "token"
  | "fuzzy"
  | "ordinal"
  | "partial_roman"
  | "multi"
  | "none";

export interface AnswerResult {
  correct: boolean;
  matchType: MatchType;
}

// ─── Roman numerals (I–XXV covers all realistic Jeopardy royalty) ────────────
const ROMAN_NUMERALS = new Set([
  "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
  "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx",
  "xxi", "xxii", "xxiii", "xxiv", "xxv",
]);

// ─── Ordinal → cardinal map ──────────────────────────────────────────────────
const ORDINAL_TO_CARDINAL: Record<string, string> = {
  first: "one",    second: "two",      third: "three",    fourth: "four",
  fifth: "five",   sixth: "six",       seventh: "seven",  eighth: "eight",
  ninth: "nine",   tenth: "ten",       eleventh: "eleven", twelfth: "twelve",
  thirteenth: "thirteen", fourteenth: "fourteen", fifteenth: "fifteen",
  sixteenth: "sixteen",   seventeenth: "seventeen", eighteenth: "eighteen",
  nineteenth: "nineteen", twentieth: "twenty",
};

// ─── Number word → digit map ─────────────────────────────────────────────────
// Normalizes "three doors down" and "3 doors down" to the same form
const WORD_TO_DIGIT: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13",
  fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20",
  thirty: "30", forty: "40", fifty: "50",
  hundred: "100", thousand: "1000",
};

// ─── Common abbreviations / short forms ──────────────────────────────────────
// Applied after normalization so punctuation is already stripped
// (e.g. "U.K." → "uk" → "united kingdom"). Both sides expand, so
// "UK" and "United Kingdom" both normalize to the same string.
const ABBREVIATIONS: Record<string, string> = {
  // Countries
  uk:   "united kingdom",
  us:   "united states",
  usa:  "united states",
  uae:  "united arab emirates",
  ussr: "soviet union",
  eu:   "european union",
  nz:   "new zealand",
  // Canadian provinces (common Jeopardy fodder)
  bc:   "british columbia",
  pei:  "prince edward island",
  // Cities
  nyc:  "new york city",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#92;/gi, "\\");
}

export function stripHtml(str: string): string {
  let result = decodeHtmlEntities(str).replace(/<[^>]+>/g, "");
  
  // Repeatedly strip escape backslashes until string stabilizes
  // (handles multiple levels of double-escaping from JSON source)
  let prev: string;
  do {
    prev = result;
    result = result.replace(/\\+([^a-zA-Z0-9\s])/g, "$1");
  } while (result !== prev);
  
  return result;
}

function normalizeAnswer(raw: string, expandParens = false): string {
  return decodeHtmlEntities(raw)
    .replace(/<[^>]+>/g, " ")          // strip HTML tags
    .replace(/\(([^)]*)\)/g, expandParens ? " $1 " : " ")  // expand or strip parentheticals
    .replace(
      /^(what (is|are|was|were)|who (is|are|was|were)|where (is|are|was|were))\s+/i,
      ""
    )                                   // strip Jeopardy phrasing
    .replace(/\s*&\s*/g, " and ")       // & → and
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")       // non-alphanumeric → space
    .replace(/\b(a|an|the)\b/g, " ")   // strip articles
    .replace(/\b\w+\b/g, (w) => {                             // ordinal → cardinal → digit
      const cardinal = ORDINAL_TO_CARDINAL[w];
      return WORD_TO_DIGIT[cardinal ?? w] ?? cardinal ?? w;
    })
    .replace(/\b\w+\b/g, (w) => ABBREVIATIONS[w] ?? w)       // expand abbreviations
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

function isRomanNumeral(token: string): boolean {
  return ROMAN_NUMERALS.has(token);
}

// True if one string is a prefix of the other (min 4 chars to avoid noise)
function prefixMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}

// Per-token fuzzy: min length 5 avoids false positives on short words like
// "ring"/"king" (4 chars). Hard cap of 2 edits prevents long-word prefix
// mismatches (e.g. "negronesia" vs "micronesia" = 3 edits) from slipping
// through even when the ratio looks acceptable.
function tokenFuzzy(a: string, b: string): boolean {
  const minLen = Math.min(a.length, b.length);
  if (minLen < 5) return false;
  const dist = levenshtein(a, b);
  return dist <= 2 && dist / Math.max(a.length, b.length) <= 0.34;
}

/**
 * Detect multi-part correct answers like "Paris/France" or "Red & Blue".
 * Returns the raw parts (pre-normalization) or null if single-part.
 */
function splitMultiPart(rawCorrect: string): string[] | null {
  const stripped = stripHtml(rawCorrect);

  // Only split on "/" — these represent genuine alternative/multi-part answers
  // (e.g. "Paris/France"). Ampersand is NOT split here because normalizeAnswer
  // converts & → "and", so "Hootie & the Blowfish" matches correctly via
  // single-part logic without being incorrectly treated as two separate parts.
  if (stripped.includes("/")) {
    const parts = stripped.split("/").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts;
  }

  return null;
}

/**
 * Check whether userNorm contains all significant tokens of partNorm.
 * Used when the correct answer requires multiple parts (e.g. "Paris/France").
 */
function userContainsPart(userTokenSet: Set<string>, partNorm: string): boolean {
  const sigPart = partNorm.split(" ").filter((t) => t.length > 2);
  if (sigPart.length === 0) return false;
  return sigPart.every((t) => userTokenSet.has(t));
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function checkAnswer(
  userAnswer: string,
  correctAnswer: string
): AnswerResult {
  const userNorm = normalizeAnswer(userAnswer);
  const correctNorm = normalizeAnswer(correctAnswer);

  if (!userNorm || !correctNorm) return { correct: false, matchType: "none" };

  // If the correct answer has optional parenthetical content like "(Roger) Ebert",
  // also try matching against the expanded form "roger ebert" so that users who
  // include the optional part are still marked correct.
  const hasParens = /\(/.test(correctAnswer);
  const correctNormExpanded = hasParens ? normalizeAnswer(correctAnswer, true) : null;

  // ── Multi-part answers (e.g. "Paris/France", "Red & Blue") ────────────────
  const parts = splitMultiPart(correctAnswer);
  if (parts) {
    const partNorms = parts.map((p) => normalizeAnswer(p));
    const userTokenSet = new Set(userNorm.split(" ").filter(Boolean));

    if (partNorms.every((p) => userContainsPart(userTokenSet, p))) {
      return { correct: true, matchType: "multi" };
    }

    // Fall through to single-part logic — the normalized strings may still
    // match exactly or via token/fuzzy even when multi-part detection fires.
  }

  // ── Single-part matching ───────────────────────────────────────────────────

  // 1. Exact match after normalization (also try expanded form)
  if (userNorm === correctNorm) return { correct: true, matchType: "exact" };
  if (correctNormExpanded && userNorm === correctNormExpanded) return { correct: true, matchType: "exact" };

  const userTokens = userNorm.split(" ").filter(Boolean);
  const correctTokens = correctNorm.split(" ").filter(Boolean);
  const correctExpandedTokens = correctNormExpanded ? correctNormExpanded.split(" ").filter(Boolean) : correctTokens;

  // 2. Roman numeral guard
  //    If the correct answer ends with a Roman numeral (e.g. "Elizabeth I")
  //    and the user provides a *different* Roman numeral → reject immediately.
  //    Omitting the numeral entirely is fine.
  const correctLastToken = correctTokens[correctTokens.length - 1];
  const userLastToken = userTokens.length > 0 ? userTokens[userTokens.length - 1] : "";

  if (correctTokens.length >= 2 && isRomanNumeral(correctLastToken)) {
    if (isRomanNumeral(userLastToken) && userLastToken !== correctLastToken) {
      // Wrong Roman numeral — definitively incorrect
      return { correct: false, matchType: "none" };
    }

    // User gave correct numeral or omitted it — compare the base name
    const correctBase = correctTokens.slice(0, -1).join(" ");
    const userBase = isRomanNumeral(userLastToken)
      ? userTokens.slice(0, -1).join(" ")
      : userNorm;

    if (userBase === correctBase) {
      return { correct: true, matchType: "partial_roman" };
    }

    // Allow fuzzy match on base name too
    if (userBase.length >= 4 && correctBase.length >= 4) {
      const dist = levenshtein(userBase, correctBase);
      if (dist / Math.max(userBase.length, correctBase.length) <= 0.2) {
        return { correct: true, matchType: "partial_roman" };
      }
    }
  }

  // 3. Token match — with prefix tolerance and both directions:
  //    a) all significant user tokens found in correct tokens (user gave subset)
  //       e.g. "kennedy" matches "John F. Kennedy"
  //    b) all significant correct tokens found in user tokens (user over-specified)
  //       e.g. "ring finger" matches "ring", "cloud watching" matches "clouds"
  //    Prefix tolerance handles stem variants: "cloud" matches "clouds"
  const sigUser = userTokens.filter((t) => t.length > 2);
  const sigCorrect = correctTokens.filter((t) => t.length > 2);
  const sigCorrectExpanded = correctExpandedTokens.filter((t) => t.length > 2);

  const forwardMatch = (uToks: string[], cToks: string[]) =>
    uToks.length > 0 && uToks.every((ut) => cToks.some((ct) => prefixMatch(ut, ct) || tokenFuzzy(ut, ct)));
  const reverseMatch = (cToks: string[], uToks: string[]) =>
    cToks.length > 0 && cToks.every((ct) => uToks.some((ut) => prefixMatch(ct, ut)));

  if (
    forwardMatch(sigUser, sigCorrect) ||
    forwardMatch(sigUser, sigCorrectExpanded) ||
    reverseMatch(sigCorrect, userTokens) ||
    reverseMatch(sigCorrectExpanded, userTokens)
  ) {
    return { correct: true, matchType: "token" };
  }

  // 4. Fuzzy match — ≤20% edit distance, minimum 4 chars
  //    Also try expanded form for cases like "roger ebert" vs "(Roger) Ebert"
  const candidates = correctNormExpanded ? [correctNorm, correctNormExpanded] : [correctNorm];
  for (const candidate of candidates) {
    const minLen = Math.min(userNorm.length, candidate.length);
    const maxLen = Math.max(userNorm.length, candidate.length);
    if (minLen >= 4) {
      const dist = levenshtein(userNorm, candidate);
      if (dist / maxLen <= 0.2) return { correct: true, matchType: "fuzzy" };
    }
  }

  // 4b. Per-token fuzzy — catches close variant spellings like "pinky"/"pinkie"
  //     Each significant correct token must fuzzy-match some user token.
  //     Uses a slightly higher per-token threshold (34%) gated on min length 5.
  const tokenFuzzyMatch = (cToks: string[], uToks: string[]) =>
    cToks.length > 0 && cToks.every((ct) => uToks.some((ut) => tokenFuzzy(ct, ut)));

  if (tokenFuzzyMatch(sigCorrect, userTokens) || tokenFuzzyMatch(sigCorrectExpanded, userTokens)) {
    return { correct: true, matchType: "fuzzy" };
  }

  return { correct: false, matchType: "none" };
}
