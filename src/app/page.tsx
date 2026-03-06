import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "@/components/LogoutButton";

const SAMPLE_CATEGORIES = [
  "Science & Nature",
  "World History",
  "Pop Culture",
  "Literature",
  "Sports",
  "Geography",
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let totalCorrect = 0;
  let totalAnswered = 0;

  if (user) {
    const { data: results } = await supabase
      .from("game_results")
      .select("correct, total")
      .eq("user_id", user.id);

    if (results) {
      totalCorrect = results.reduce((sum, r) => sum + r.correct, 0);
      totalAnswered = results.reduce((sum, r) => sum + r.total, 0);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      {/* Header */}
      <header className="w-full px-6 py-4 flex justify-end">
        {user ? (
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p
                className="text-sm font-semibold truncate max-w-[200px]"
                style={{ color: "rgba(255,255,255,0.75)" }}
              >
                {user.email}
              </p>
              {totalAnswered > 0 && (
                <p className="text-xs" style={{ color: "rgba(255,215,0,0.8)" }}>
                  {totalCorrect}/{totalAnswered} correct
                  {" "}({Math.round((totalCorrect / totalAnswered) * 100)}%)
                </p>
              )}
            </div>
            <LogoutButton />
          </div>
        ) : (
          <nav className="flex gap-4">
            <Link
              href="/login"
              className="px-5 py-2 rounded border-2 text-white font-semibold transition-colors hover:bg-white hover:text-[#060CE9]"
              style={{ borderColor: "#FFD700" }}
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="px-5 py-2 rounded font-semibold transition-colors hover:opacity-90"
              style={{ backgroundColor: "#FFD700", color: "#060CE9" }}
            >
              Sign Up
            </Link>
          </nav>
        )}
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        {/* Logo / Title */}
        <div className="mb-4">
          <div
            className="inline-block px-8 py-2 rounded-sm mb-2"
            style={{ backgroundColor: "#060CE9", border: "3px solid #FFD700" }}
          >
            <span
              className="text-xs font-bold uppercase tracking-[0.3em]"
              style={{ color: "#FFD700" }}
            >
              This is
            </span>
          </div>
        </div>

        <h1
          className="text-7xl sm:text-8xl md:text-9xl font-black uppercase tracking-tight mb-2 select-none"
          style={{
            color: "#FFD700",
            textShadow: "4px 4px 0px #c8a800, 8px 8px 0px rgba(0,0,0,0.3)",
            fontFamily: "Impact, 'Arial Black', sans-serif",
            letterSpacing: "-0.02em",
          }}
        >
          Jeopardy!
        </h1>

        <p
          className="text-lg sm:text-xl font-semibold mb-10 max-w-md"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          Test your knowledge with thousands of real Jeopardy! archive questions
          across hundreds of categories.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 mb-16">
          <Link
            href="/play"
            className="px-10 py-4 rounded text-xl font-black uppercase tracking-wide transition-all hover:opacity-90 hover:scale-105 active:scale-95"
            style={{
              backgroundColor: "#FFD700",
              color: "#060CE9",
              fontFamily: "Impact, 'Arial Black', sans-serif",
            }}
          >
            Play Now
          </Link>
          {!user && (
            <Link
              href="/signup"
              className="px-10 py-4 rounded text-xl font-bold uppercase tracking-wide border-2 text-white transition-all hover:bg-white hover:text-[#060CE9] hover:scale-105 active:scale-95"
              style={{ borderColor: "#FFD700" }}
            >
              Track Your Score
            </Link>
          )}
        </div>

        {/* Feature callout */}
        <div
          className="flex flex-wrap justify-center gap-6 mb-16 text-sm font-semibold max-w-xl"
          style={{ color: "rgba(255,255,255,0.7)" }}
        >
          <span>✓ Thousands of archive questions</span>
          <span>✓ Real Jeopardy! categories</span>
          <span>✓ Track your score over time</span>
          <span>✓ No login required to play</span>
        </div>

        {/* Category Preview */}
        <div className="w-full max-w-3xl">
          <p
            className="text-xs uppercase font-bold tracking-widest mb-4"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            Sample Categories
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {SAMPLE_CATEGORIES.map((cat) => (
              <div
                key={cat}
                className="flex items-center justify-center p-3 rounded text-center text-xs font-bold uppercase leading-tight"
                style={{
                  backgroundColor: "#040a9e",
                  border: "2px solid #FFD700",
                  color: "#FFD700",
                  minHeight: "70px",
                }}
              >
                {cat}
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        className="w-full text-center py-4 text-xs"
        style={{ color: "rgba(255,255,255,0.4)", borderTop: "1px solid rgba(255,215,0,0.2)" }}
      >
        Questions sourced from the J! Archive. Not affiliated with Jeopardy! Productions, Inc.
      </footer>
    </div>
  );
}
