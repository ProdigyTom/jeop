"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { checkAnswer, stripHtml, type MatchType } from "@/lib/answerUtils";

// ─── Types ───────────────────────────────────────────────────────────────────

type GameState = "loading" | "reveal" | "question" | "feedback" | "results";

interface Clue {
  id: number;
  question: string;
  answer: string;
  value: number;
}

interface Category {
  id: number;
  title: string;
  clues: Clue[];
}

interface AnswerRecord {
  clue: Clue;
  userAnswer: string;
  correct: boolean;
  matchType: MatchType;
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({
  userEmail,
  sessionScore,
}: {
  userEmail: string | null;
  sessionScore: { correct: number; total: number };
}) {
  return (
    <header
      className="w-full px-6 py-3 flex justify-between items-center flex-shrink-0"
      style={{ borderBottom: "1px solid rgba(255,215,0,0.2)" }}
    >
      <Link href="/">
        <span
          className="text-2xl font-black uppercase"
          style={{
            color: "#FFD700",
            fontFamily: "Impact, 'Arial Black', sans-serif",
          }}
        >
          Jeopardy!
        </span>
      </Link>
      <div className="flex items-center gap-4">
        {sessionScore.total > 0 && (
          <span
            className="text-sm font-semibold"
            style={{ color: "rgba(255,215,0,0.85)" }}
          >
            {sessionScore.correct}/{sessionScore.total} this session
          </span>
        )}
        {userEmail ? (
          <span
            className="text-xs hidden sm:block truncate max-w-[160px]"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            {userEmail}
          </span>
        ) : (
          <Link
            href="/login"
            className="text-xs hover:underline"
            style={{ color: "rgba(255,215,0,0.6)" }}
          >
            Sign in to save score
          </Link>
        )}
      </div>
    </header>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PlayPage() {
  const supabase = useMemo(() => createClient(), []);

  const [gameState, setGameState] = useState<GameState>("loading");
  const [category, setCategory] = useState<Category | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [lastResult, setLastResult] = useState<{
    correct: boolean;
    matchType: MatchType;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionScore, setSessionScore] = useState({ correct: 0, total: 0 });
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Check auth on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email ?? null);
    });
  }, [supabase]);

  // Load a new category
  const loadCategory = useCallback(async () => {
    setGameState("loading");
    setError(null);
    setCurrentIndex(0);
    setAnswers([]);
    setUserInput("");
    setLastResult(null);

    try {
      const res = await fetch("/api/play/category");
      if (!res.ok) throw new Error("Failed to load category");
      const data: Category = await res.json();
      setCategory(data);
      setGameState("reveal");
    } catch {
      setError("Could not load a category. Please try again.");
    }
  }, []);

  useEffect(() => {
    loadCategory();
  }, [loadCategory]);

  // Category reveal: count down 3→2→1 then start
  const [revealCount, setRevealCount] = useState(3);
  useEffect(() => {
    if (gameState !== "reveal") return;
    setRevealCount(3);
    const interval = setInterval(() => {
      setRevealCount((n) => {
        if (n <= 1) {
          clearInterval(interval);
          setGameState("question");
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState]);

  // Focus input whenever a new question is shown
  useEffect(() => {
    if (gameState === "question") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [gameState, currentIndex]);

  // Save score to Supabase (silently — table may not exist yet)
  async function saveScore(
    categoryTitle: string,
    correct: number,
    total: number
  ) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("game_results")
      .insert({ user_id: user.id, category_name: categoryTitle, correct, total });
  }

  function handleSubmit() {
    if (!category || !userInput.trim() || gameState !== "question") return;

    const clue = category.clues[currentIndex];
    const result = checkAnswer(userInput, clue.answer);
    const record: AnswerRecord = {
      clue,
      userAnswer: userInput,
      correct: result.correct,
      matchType: result.matchType,
    };

    const newAnswers = [...answers, record];
    setAnswers(newAnswers);
    setLastResult(result);
    setGameState("feedback");
    setSessionScore((s) => ({
      correct: s.correct + (result.correct ? 1 : 0),
      total: s.total + 1,
    }));

    // Save after the last question
    if (currentIndex === category.clues.length - 1) {
      const totalCorrect = newAnswers.filter((a) => a.correct).length;
      saveScore(category.title, totalCorrect, newAnswers.length);
    }
  }

  function handleNext() {
    if (!category) return;
    if (currentIndex < category.clues.length - 1) {
      setCurrentIndex((i) => i + 1);
      setUserInput("");
      setLastResult(null);
      setGameState("question");
    } else {
      setGameState("results");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      if (gameState === "question") handleSubmit();
      else if (gameState === "feedback") handleNext();
    }
  }

  const totalQuestions = category?.clues.length ?? 0;
  const currentClue = category?.clues[currentIndex];

  // ─── Category Reveal ─────────────────────────────────────────────────────

  if (gameState === "reveal" && category) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
        style={{ backgroundColor: "#060CE9" }}
      >
        <p
          className="text-xs font-bold uppercase tracking-[0.3em] mb-6"
          style={{ color: "rgba(255,215,0,0.6)" }}
        >
          Your category is
        </p>

        <h1
          className="text-5xl sm:text-6xl md:text-7xl font-black uppercase leading-tight mb-10 max-w-2xl"
          style={{
            color: "#FFD700",
            fontFamily: "Impact, 'Arial Black', sans-serif",
            textShadow: "3px 3px 0px #c8a800",
          }}
        >
          {category.title}
        </h1>

        {/* Countdown dots */}
        <div className="flex gap-3">
          {[3, 2, 1].map((n) => (
            <div
              key={n}
              className="w-4 h-4 rounded-full transition-all duration-300"
              style={{
                backgroundColor:
                  revealCount >= n ? "#FFD700" : "rgba(255,255,255,0.2)",
                transform: revealCount === n ? "scale(1.4)" : "scale(1)",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ─── Loading / Error ─────────────────────────────────────────────────────

  if (gameState === "loading" || !category) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center"
        style={{ backgroundColor: "#060CE9" }}
      >
        {error ? (
          <div className="text-center px-4">
            <p className="text-white mb-6 text-lg">{error}</p>
            <button
              onClick={loadCategory}
              className="px-8 py-3 rounded font-black uppercase tracking-wide cursor-pointer"
              style={{
                backgroundColor: "#FFD700",
                color: "#060CE9",
                fontFamily: "Impact, 'Arial Black', sans-serif",
              }}
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white font-semibold">Loading category…</p>
          </div>
        )}
      </div>
    );
  }

  // ─── Results ─────────────────────────────────────────────────────────────

  if (gameState === "results") {
    const categoryCorrect = answers.filter((a) => a.correct).length;
    const pct = Math.round((categoryCorrect / totalQuestions) * 100);

    return (
      <div
        className="min-h-screen flex flex-col"
        style={{ backgroundColor: "#060CE9" }}
      >
        <Header userEmail={userEmail} sessionScore={sessionScore} />
        <main className="flex-1 flex flex-col items-center px-4 py-8 overflow-y-auto">
          <div className="w-full max-w-xl">
            {/* Score banner */}
            <div
              className="rounded-lg p-6 mb-5 text-center"
              style={{ backgroundColor: "#040a9e", border: "2px solid #FFD700" }}
            >
              <p
                className="text-xs uppercase tracking-widest font-bold mb-1"
                style={{ color: "rgba(255,215,0,0.6)" }}
              >
                Category Complete
              </p>
              <h2
                className="text-2xl font-black uppercase mb-4"
                style={{
                  color: "#FFD700",
                  fontFamily: "Impact, 'Arial Black', sans-serif",
                }}
              >
                {category.title}
              </h2>
              <div className="text-6xl font-black text-white mb-1">
                {categoryCorrect}
                <span className="text-3xl text-white/40">/{totalQuestions}</span>
              </div>
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                {categoryCorrect === totalQuestions
                  ? "🎉 Perfect score!"
                  : categoryCorrect === 0
                  ? "Better luck next time!"
                  : `${pct}% correct`}
              </p>
            </div>

            {/* Per-answer review */}
            <div className="flex flex-col gap-3 mb-6">
              {answers.map((record, i) => (
                <div
                  key={record.clue.id}
                  className="rounded-lg p-4"
                  style={{
                    backgroundColor: record.correct
                      ? "rgba(34,197,94,0.12)"
                      : "rgba(239,68,68,0.12)",
                    border: `1px solid ${record.correct ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
                  }}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs font-bold mb-1"
                        style={{ color: "rgba(255,215,0,0.6)" }}
                      >
                        ${record.clue.value} · Q{i + 1}
                      </p>
                      <p className="text-white/80 text-sm mb-2 leading-snug">
                        {stripHtml(record.clue.question)}
                      </p>
                      {!record.correct && (
                        <p
                          className="text-xs mb-1"
                          style={{ color: "rgba(255,255,255,0.5)" }}
                        >
                          Your answer:{" "}
                          <span className="text-red-400">
                            &ldquo;{record.userAnswer}&rdquo;
                          </span>
                        </p>
                      )}
                      <p className="text-xs font-semibold">
                        Answer:{" "}
                        <span
                          style={{ color: record.correct ? "#86efac" : "#fca5a5" }}
                        >
                          {stripHtml(record.clue.answer)}
                        </span>
                      </p>
                    </div>
                    <span className="text-xl flex-shrink-0 mt-1">
                      {record.correct ? "✓" : "✗"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={loadCategory}
              className="w-full py-4 rounded font-black uppercase text-lg tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer"
              style={{
                backgroundColor: "#FFD700",
                color: "#060CE9",
                fontFamily: "Impact, 'Arial Black', sans-serif",
              }}
            >
              Play Another Category
            </button>

            <div className="text-center mt-5">
              <Link
                href="/"
                className="text-sm hover:underline"
                style={{ color: "rgba(255,215,0,0.55)" }}
              >
                ← Back to Home
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ─── Question / Feedback ─────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#060CE9" }}
    >
      <Header userEmail={userEmail} sessionScore={sessionScore} />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-xl">
          {/* Progress dots */}
          <div className="flex justify-between items-center mb-4 px-1">
            <p
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: "rgba(255,215,0,0.6)" }}
            >
              Question {currentIndex + 1} of {totalQuestions}
            </p>
            <div className="flex gap-2">
              {category.clues.map((_, i) => (
                <div
                  key={i}
                  className="w-2.5 h-2.5 rounded-full transition-colors"
                  style={{
                    backgroundColor:
                      i < currentIndex
                        ? answers[i]?.correct
                          ? "#86efac"
                          : "#f87171"
                        : i === currentIndex
                        ? "#FFD700"
                        : "rgba(255,255,255,0.2)",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Clue card */}
          <div
            className="rounded-lg p-8 mb-5 text-center flex flex-col items-center justify-center"
            style={{
              backgroundColor: "#040a9e",
              border: "2px solid #FFD700",
              minHeight: "200px",
            }}
          >
            <p
              className="text-xs font-black uppercase tracking-widest mb-2"
              style={{ color: "rgba(255,215,0,0.65)" }}
            >
              {category.title}
            </p>
            <p
              className="text-3xl font-black mb-5"
              style={{
                color: "#FFD700",
                fontFamily: "Impact, 'Arial Black', sans-serif",
              }}
            >
              ${currentClue!.value}
            </p>
            <p className="text-white text-lg leading-relaxed">
              {stripHtml(currentClue!.question)}
            </p>
          </div>

          {/* Answer input */}
          {gameState === "question" && (
            <div>
              <div className="flex gap-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Your answer…"
                  className="flex-1 px-4 py-3 rounded text-white text-lg placeholder-white/35 outline-none focus:ring-2 focus:ring-yellow-400"
                  style={{
                    backgroundColor: "#040a9e",
                    border: "1px solid rgba(255,215,0,0.4)",
                  }}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!userInput.trim()}
                  className="px-6 py-3 rounded font-black uppercase text-sm tracking-wide transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
                  style={{
                    backgroundColor: "#FFD700",
                    color: "#060CE9",
                    fontFamily: "Impact, 'Arial Black', sans-serif",
                  }}
                >
                  Submit
                </button>
              </div>
              <p
                className="text-xs mt-2 text-center"
                style={{ color: "rgba(255,255,255,0.3)" }}
              >
                Press Enter to submit
              </p>
            </div>
          )}

          {/* Feedback */}
          {gameState === "feedback" && lastResult && (
            <div
              className="rounded-lg p-5"
              style={{
                backgroundColor: lastResult.correct
                  ? "rgba(34,197,94,0.15)"
                  : "rgba(239,68,68,0.15)",
                border: `1px solid ${lastResult.correct ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}`,
              }}
            >
              <div className="flex items-start gap-3 mb-3">
                <span className="text-3xl leading-none">
                  {lastResult.correct ? "✓" : "✗"}
                </span>
                <div>
                  <p
                    className="font-black text-lg leading-tight"
                    style={{
                      color: lastResult.correct ? "#86efac" : "#f87171",
                    }}
                  >
                    {lastResult.correct ? "Correct!" : "Incorrect"}
                  </p>
                  {lastResult.correct && lastResult.matchType === "fuzzy" && (
                    <p
                      className="text-xs"
                      style={{ color: "rgba(255,255,255,0.5)" }}
                    >
                      Close enough — fuzzy match accepted
                    </p>
                  )}
                  {lastResult.correct && lastResult.matchType === "token" && (
                    <p
                      className="text-xs"
                      style={{ color: "rgba(255,255,255,0.5)" }}
                    >
                      Partial match accepted
                    </p>
                  )}
                </div>
              </div>

              {!lastResult.correct && (
                <p
                  className="text-sm mb-2"
                  style={{ color: "rgba(255,255,255,0.6)" }}
                >
                  You answered:{" "}
                  <span className="text-red-400 font-semibold">
                    &ldquo;{answers[answers.length - 1]?.userAnswer}&rdquo;
                  </span>
                </p>
              )}

              <p className="text-sm font-semibold text-white">
                Answer:{" "}
                <span style={{ color: "#FFD700" }}>
                  {stripHtml(currentClue!.answer)}
                </span>
              </p>

              <button
                onClick={handleNext}
                className="w-full mt-4 py-3 rounded font-black uppercase text-sm tracking-wide transition-all hover:opacity-90 cursor-pointer"
                style={{
                  backgroundColor: "#FFD700",
                  color: "#060CE9",
                  fontFamily: "Impact, 'Arial Black', sans-serif",
                }}
              >
                {currentIndex < totalQuestions - 1
                  ? "Next Question →"
                  : "See Results →"}
              </button>
              <p
                className="text-xs mt-2 text-center"
                style={{ color: "rgba(255,255,255,0.3)" }}
              >
                Press Enter to continue
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
