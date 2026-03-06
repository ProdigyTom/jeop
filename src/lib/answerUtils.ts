export type MatchType = "exact" | "token" | "fuzzy" | "none";

export interface AnswerResult {
  correct: boolean;
  matchType: MatchType;
}

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
    .replace(/<[^>]+>/g, " ") // strip HTML tags
    .replace(/\(.*?\)/g, " ") // strip parentheticals like (River) or (optional)
    .replace(
      /^(what (is|are|was|were)|who (is|are|was|were)|where (is|are|was|were))\s+/i,
      ""
    ) // strip Jeopardy phrasing
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // non-alphanumeric → space
    .replace(/\b(a|an|the)\b/g, " ") // strip articles
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
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

export function checkAnswer(
  userAnswer: string,
  correctAnswer: string
): AnswerResult {
  const userNorm = normalizeAnswer(userAnswer);
  const correctNorm = normalizeAnswer(correctAnswer);

  if (!userNorm || !correctNorm) return { correct: false, matchType: "none" };

  // 1. Exact match after normalization
  if (userNorm === correctNorm) return { correct: true, matchType: "exact" };

  const userTokens = userNorm.split(" ").filter(Boolean);
  const correctTokens = correctNorm.split(" ").filter(Boolean);

  // 2. Token match — all significant user tokens found in correct tokens
  //    Handles "Kennedy" matching "John F. Kennedy"
  const sigUser = userTokens.filter((t) => t.length > 2);
  const sigCorrect = correctTokens.filter((t) => t.length > 2);
  if (sigUser.length > 0 && sigUser.every((t) => sigCorrect.includes(t))) {
    return { correct: true, matchType: "token" };
  }

  // 3. Fuzzy match — ≤20% edit distance, minimum 4 chars
  //    Handles "missisipi" matching "mississippi"
  const minLen = Math.min(userNorm.length, correctNorm.length);
  const maxLen = Math.max(userNorm.length, correctNorm.length);
  if (minLen >= 4) {
    const dist = levenshtein(userNorm, correctNorm);
    if (dist / maxLen <= 0.2) return { correct: true, matchType: "fuzzy" };
  }

  return { correct: false, matchType: "none" };
}
