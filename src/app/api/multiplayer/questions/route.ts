import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripHtml } from "@/lib/answerUtils";
import type { MultiplayerClue } from "@/lib/multiplayerTypes";

// Build a value ladder for `count` questions that generally increases.
// e.g. count=5  → [200, 400, 600, 800, 1000]
//      count=10 → [200, 200, 400, 400, 600, 600, 800, 800, 1000, 1000]
function buildValueLadder(count: number): number[] {
  const tiers = [200, 400, 600, 800, 1000];
  const ladder: number[] = [];
  for (let i = 0; i < count; i++) {
    const tierIndex = Math.floor((i / count) * tiers.length);
    ladder.push(tiers[Math.min(tierIndex, tiers.length - 1)]);
  }
  return ladder;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rounds = Math.min(5, Math.max(1, Number(searchParams.get("rounds") ?? "1")));
  const perRound = Math.min(10, Math.max(3, Number(searchParams.get("perRound") ?? "5")));
  const totalNeeded = rounds * perRound;

  // Also fetch a final jeopardy clue if requested
  const withFJ = searchParams.get("fj") === "1";

  try {
    const supabase = await createClient();

    // Fetch a large pool of clues with values in our range, from varied categories.
    // We'll shuffle and pick `totalNeeded` from the pool.
    const { data: pool, error } = await supabase
      .from("clues")
      .select("id, clue_value, answer, question, category")
      .not("clue_value", "is", null)
      .not("answer", "is", null)
      .not("question", "is", null)
      .gte("clue_value", 100)
      .lte("clue_value", 1200)
      .limit(500);

    if (error || !pool?.length) {
      return NextResponse.json({ error: "Failed to fetch clues" }, { status: 503 });
    }

    // Filter out clues with empty/trivial content
    const valid = pool.filter((c) => {
      const q = stripHtml(c.answer as string).trim();
      const a = stripHtml(c.question as string).trim();
      return q.length > 10 && a.length > 1;
    });

    if (valid.length < totalNeeded) {
      return NextResponse.json({ error: "Not enough clues" }, { status: 503 });
    }

    // Shuffle pool
    for (let i = valid.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [valid[i], valid[j]] = [valid[j], valid[i]];
    }

    // Build rounds: each round's clues sorted by value ascending
    const allRounds: MultiplayerClue[][] = [];
    let pick = 0;
    for (let r = 0; r < rounds; r++) {
      const ladder = buildValueLadder(perRound);
      // Pick `perRound` clues for this round
      const roundClues = valid.slice(pick, pick + perRound);
      pick += perRound;
      // Sort them by actual clue_value to match the ascending ladder shape,
      // then stamp each with the ladder value for display purposes
      roundClues.sort((a, b) => (a.clue_value ?? 0) - (b.clue_value ?? 0));
      allRounds.push(
        roundClues.map((c, i) => ({
          id: c.id as number,
          question: stripHtml(c.answer as string),
          answer: stripHtml(c.question as string),
          value: ladder[i],
          category: stripHtml(c.category as string),
        }))
      );
    }

    // Final jeopardy: highest-value clue from pool not already used
    let fjClue: MultiplayerClue | null = null;
    if (withFJ) {
      const remaining = valid.slice(pick);
      const highest = [...remaining].sort(
        (a, b) => (b.clue_value ?? 0) - (a.clue_value ?? 0)
      )[0];
      if (highest) {
        fjClue = {
          id: highest.id as number,
          question: stripHtml(highest.answer as string),
          answer: stripHtml(highest.question as string),
          value: highest.clue_value as number,
          category: stripHtml(highest.category as string),
        };
      }
    }

    return NextResponse.json({ rounds: allRounds, fjClue });
  } catch (err) {
    console.error("Multiplayer questions error:", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
