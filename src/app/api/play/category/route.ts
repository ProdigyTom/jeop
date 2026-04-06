import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripHtml } from "@/lib/answerUtils";

export async function GET() {
  try {
    const supabase = await createClient();

    // Count valid categories (those with ≥5 clues)
    const { count, error: countError } = await supabase
      .from("categories")
      .select("*", { count: "exact", head: true })
      .gte("clue_count", 5);

    if (countError || !count) {
      return NextResponse.json(
        { error: "Failed to load categories." },
        { status: 503 }
      );
    }

    // Try a few random categories until we find one with a complete single-episode set
    for (let attempt = 0; attempt < 5; attempt++) {
      const offset = Math.floor(Math.random() * count);
      const { data: catRows } = await supabase
        .from("categories")
        .select("name")
        .gte("clue_count", 5)
        .range(offset, offset);

      if (!catRows?.length) continue;
      const categoryName = catRows[0].name;

      // Fetch up to 100 clues for this category so we have multiple episodes to
      // choose from. We'll group by air_date and pick a complete set (5 clues
      // from the same episode), which guarantees the authentic value progression.
      const { data: rows } = await supabase
        .from("clues")
        .select("id, clue_value, answer, question, air_date")
        .eq("category", categoryName)
        .not("clue_value", "is", null)
        .not("air_date", "is", null)
        .limit(100);

      if (!rows?.length) continue;

      // Group clues by episode (air_date)
      const byDate = new Map<string, typeof rows>();
      for (const row of rows) {
        const key = row.air_date as string;
        const arr = byDate.get(key) ?? [];
        arr.push(row);
        byDate.set(key, arr);
      }

      // Keep only complete sets of exactly 5 clues from one episode
      const complete = [...byDate.values()].filter((ep) => ep.length === 5);

      // Fall back to any set with ≥3 clues if no perfect set found
      const candidates =
        complete.length > 0
          ? complete
          : [...byDate.values()].filter((ep) => ep.length >= 3);

      if (!candidates.length) continue;

      // Pick a random episode set
      const chosen =
        candidates[Math.floor(Math.random() * candidates.length)];
      const clues = chosen.sort(
        (a, b) => (a.clue_value ?? 0) - (b.clue_value ?? 0)
      );

      return NextResponse.json({
        id: offset,
        title: stripHtml(categoryName),
        clues: clues.map((c) => ({
          id: c.id,
          question: stripHtml(c.answer as string),  // "answer" in Jeopardy data = clue text shown on board
          answer: stripHtml(c.question as string),  // "question" in Jeopardy data = correct response
          value: c.clue_value,
        })),
      });
    }

    return NextResponse.json(
      { error: "Failed to load a category. Please try again." },
      { status: 503 }
    );
  } catch (err) {
    console.error("Category route error:", err);
    return NextResponse.json(
      { error: "Unexpected error loading category." },
      { status: 500 }
    );
  }
}
