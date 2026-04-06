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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

export function stripHtml(str: string): string {
  return decodeHtmlEntities(str)
    .replace(/<[^>]+>/g, "")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function normalizeAnswer(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/<[^>]+>/g, " ")          // strip HTML tags
    .replace(/\(.*?\)/g, " ")          // strip parentheticals
    .replace(
      /^(what (is|are|was|were)|who (is|are|was|were)|where (is|are|was|were))\s+/i,
      ""
    )                                   // strip Jeopardy phrasing
    .replace(/\s*&\s*/g, " and ")       // & → and
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")       // non-alphanumeric → space
    .replace(/\b(a|an|the)\b/g, " ")   // strip articles
    .replace(/\b\w+\b/g, (w) => ORDINAL_TO_CARDINAL[w] ?? w) // ordinal → cardinal
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

/**
 * Detect multi-part correct answers like "Paris/France" or "Red & Blue".
 * Returns the raw parts (pre-normalization) or null if single-part.
 */
function splitMultiPart(rawCorrect: string): string[] | null {
  const stripped = stripHtml(rawCorrect);

  if (stripped.includes("/")) {
    const parts = stripped.split("/").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return parts;
  }

  if (/&/.test(stripped)) {
    const parts = stripped.split(/\s*&\s*/).map((s) => s.trim()).filter(Boolean);
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

  // ── Multi-part answers (e.g. "Paris/France", "Red & Blue") ────────────────
  const parts = splitMultiPart(correctAnswer);
  if (parts) {
    const partNorms = parts.map((p) => normalizeAnswer(p));
    const userTokenSet = new Set(userNorm.split(" ").filter(Boolean));

    if (partNorms.every((p) => userContainsPart(userTokenSet, p))) {
      return { correct: true, matchType: "multi" };
    }

    // Still allow a very tight fuzzy match on the full concatenated answer
    const minLen = Math.min(userNorm.length, correctNorm.length);
    const maxLen = Math.max(userNorm.length, correctNorm.length);
    if (minLen >= 4) {
      const dist = levenshtein(userNorm, correctNorm);
      if (dist / maxLen <= 0.15) return { correct: true, matchType: "fuzzy" };
    }

    return { correct: false, matchType: "none" };
  }

  // ── Single-part matching ───────────────────────────────────────────────────

  // 1. Exact match after normalization
  if (userNorm === correctNorm) return { correct: true, matchType: "exact" };

  const userTokens = userNorm.split(" ").filter(Boolean);
  const correctTokens = correctNorm.split(" ").filter(Boolean);

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

  // 3. Token match — all significant user tokens found in correct tokens
  //    e.g. "kennedy" matches "John F. Kennedy"
  const sigUser = userTokens.filter((t) => t.length > 2);
  const sigCorrect = correctTokens.filter((t) => t.length > 2);
  if (sigUser.length > 0 && sigUser.every((t) => sigCorrect.includes(t))) {
    // Extra guard: if user included a Roman numeral that's different from
    // correct's last token, we already rejected above. But if correct has
    // NO Roman numeral suffix and user supplied one, that's suspicious —
    // allow it only if the numeral is in the correct tokens.
    return { correct: true, matchType: "token" };
  }

  // 4. Fuzzy match — ≤20% edit distance, minimum 4 chars
  const minLen = Math.min(userNorm.length, correctNorm.length);
  const maxLen = Math.max(userNorm.length, correctNorm.length);
  if (minLen >= 4) {
    const dist = levenshtein(userNorm, correctNorm);
    if (dist / maxLen <= 0.2) return { correct: true, matchType: "fuzzy" };
  }

  return { correct: false, matchType: "none" };
}
