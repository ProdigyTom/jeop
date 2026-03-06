import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    // Pick a random category by offset
    const offset = Math.floor(Math.random() * count);
    const { data: catRows, error: catError } = await supabase
      .from("categories")
      .select("name")
      .gte("clue_count", 5)
      .range(offset, offset);

    if (catError || !catRows?.length) {
      return NextResponse.json(
        { error: "Failed to pick a category." },
        { status: 503 }
      );
    }

    const categoryName = catRows[0].name;

    // Fetch up to 5 clues for that category, ordered by value
    const { data: clues, error: cluesError } = await supabase
      .from("clues")
      .select("id, clue_value, answer, question")
      .eq("category", categoryName)
      .not("clue_value", "is", null)
      .order("clue_value", { ascending: true })
      .limit(5);

    if (cluesError || !clues?.length) {
      return NextResponse.json(
        { error: "Failed to load clues." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      id: offset,
      title: categoryName,
      clues: clues.map((c) => ({
        id: c.id,
        question: c.answer,   // "answer" in Jeopardy DB = the clue text shown on board
        answer: c.question,   // "question" in Jeopardy DB = the correct response
        value: c.clue_value,
      })),
    });
  } catch (err) {
    console.error("Category route error:", err);
    return NextResponse.json(
      { error: "Unexpected error loading category." },
      { status: 500 }
    );
  }
}
