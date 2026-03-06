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

// ─── Icons ───────────────────────────────────────────────────────────────────

function SpeakerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

// ─── Mute button (reused in header and reveal screen) ────────────────────────

function MuteButton({
  muted,
  onToggle,
  className = "",
}: {
  muted: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onToggle}
      title={muted ? "Unmute" : "Mute"}
      className={`p-2 rounded transition-opacity hover:opacity-70 cursor-pointer ${className}`}
      style={{ color: muted ? "rgba(255,255,255,0.3)" : "#FFD700" }}
    >
      {muted ? <MutedIcon /> : <SpeakerIcon />}
    </button>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({
  userEmail,
  sessionScore,
  muted,
  onToggleMute,
}: {
  userEmail: string | null;
  sessionScore: { correct: number; total: number };
  muted: boolean;
  onToggleMute: () => void;
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
          <span className="text-sm font-semibold" style={{ color: "rgba(255,215,0,0.85)" }}>
            {sessionScore.correct}/{sessionScore.total} this session
          </span>
        )}
        {userEmail ? (
          <span className="text-xs hidden sm:block truncate max-w-[160px]"
            style={{ color: "rgba(255,255,255,0.5)" }}>
            {userEmail}
          </span>
        ) : (
          <Link href="/login" className="text-xs hover:underline"
            style={{ color: "rgba(255,215,0,0.6)" }}>
            Sign in to save score
          </Link>
        )}
        <MuteButton muted={muted} onToggle={onToggleMute} />
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
  const [muted, setMuted] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("jeop-muted") === "true";
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Incremented each time loadCategory is called so stale concurrent fetches
  // (e.g. from React Strict Mode double-invoking effects) are discarded.
  const loadGenRef = useRef(0);

  // ─── TTS helpers ───────────────────────────────────────────────────────────

  function speak(text: string) {
    if (mutedRef.current || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.92;
    window.speechSynthesis.speak(utter);
  }

  function cancelSpeech() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem("jeop-muted", String(next));
    if (next) cancelSpeech();
  }

  // Cancel speech when leaving the page
  useEffect(() => () => cancelSpeech(), []);

  // ─── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email ?? null);
    });
  }, [supabase]);

  // ─── Category loading ──────────────────────────────────────────────────────

  const loadCategory = useCallback(async () => {
    const gen = ++loadGenRef.current;
    cancelSpeech();
    setCategory(null);
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
      if (gen !== loadGenRef.current) return; // a newer request superseded this one
      setCategory(data);
      setGameState("reveal");
    } catch {
      if (gen !== loadGenRef.current) return;
      setError("Could not load a category. Please try again.");
    }
  }, []);

  useEffect(() => { loadCategory(); }, [loadCategory]);

  // ─── Category reveal countdown ─────────────────────────────────────────────

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

  // Speak category name during reveal
  useEffect(() => {
    if (gameState === "reveal" && category) {
      speak(`Your category is: ${category.title.toLowerCase()}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState]);

  // ─── Question TTS ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (gameState === "question" && category) {
      speak(stripHtml(category.clues[currentIndex].question));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, currentIndex]);

  // ─── Input focus ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (gameState === "question") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [gameState, currentIndex]);

  // ─── Score saving ──────────────────────────────────────────────────────────

  async function saveScore(categoryTitle: string, correct: number, total: number) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("game_results")
      .insert({ user_id: user.id, category_name: categoryTitle, correct, total });
  }

  // ─── Game actions ──────────────────────────────────────────────────────────

  function handleSubmit() {
    if (!category || !userInput.trim() || gameState !== "question") return;
    cancelSpeech();

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

  // ─── Category Reveal ───────────────────────────────────────────────────────

  if (gameState === "reveal" && category) {
    return (
      <div
        className="relative min-h-screen flex flex-col items-center justify-center px-6 text-center"
        style={{ backgroundColor: "#060CE9" }}
      >
        <div className="absolute top-4 right-4">
          <MuteButton muted={muted} onToggle={toggleMute} />
        </div>

        <p className="text-xs font-bold uppercase tracking-[0.3em] mb-6"
          style={{ color: "rgba(255,215,0,0.6)" }}>
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

        <div className="flex gap-3">
          {[3, 2, 1].map((n) => (
            <div
              key={n}
              className="w-4 h-4 rounded-full transition-all duration-300"
              style={{
                backgroundColor: revealCount >= n ? "#FFD700" : "rgba(255,255,255,0.2)",
                transform: revealCount === n ? "scale(1.4)" : "scale(1)",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ─── Loading / Error ───────────────────────────────────────────────────────

  if (gameState === "loading" || !category) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center"
        style={{ backgroundColor: "#060CE9" }}>
        {error ? (
          <div className="text-center px-4">
            <p className="text-white mb-6 text-lg">{error}</p>
            <button onClick={loadCategory}
              className="px-8 py-3 rounded font-black uppercase tracking-wide cursor-pointer"
              style={{ backgroundColor: "#FFD700", color: "#060CE9", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
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

  // ─── Results ───────────────────────────────────────────────────────────────

  if (gameState === "results") {
    const categoryCorrect = answers.filter((a) => a.correct).length;
    const pct = Math.round((categoryCorrect / totalQuestions) * 100);

    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
        <Header userEmail={userEmail} sessionScore={sessionScore}
          muted={muted} onToggleMute={toggleMute} />
        <main className="flex-1 flex flex-col items-center px-4 py-8 overflow-y-auto">
          <div className="w-full max-w-xl">
            <div className="rounded-lg p-6 mb-5 text-center"
              style={{ backgroundColor: "#040a9e", border: "2px solid #FFD700" }}>
              <p className="text-xs uppercase tracking-widest font-bold mb-1"
                style={{ color: "rgba(255,215,0,0.6)" }}>
                Category Complete
              </p>
              <h2 className="text-2xl font-black uppercase mb-4"
                style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                {category.title}
              </h2>
              <div className="text-6xl font-black text-white mb-1">
                {categoryCorrect}
                <span className="text-3xl text-white/40">/{totalQuestions}</span>
              </div>
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                {categoryCorrect === totalQuestions ? "🎉 Perfect score!"
                  : categoryCorrect === 0 ? "Better luck next time!"
                  : `${pct}% correct`}
              </p>
            </div>

            <div className="flex flex-col gap-3 mb-6">
              {answers.map((record, i) => (
                <div key={record.clue.id} className="rounded-lg p-4"
                  style={{
                    backgroundColor: record.correct ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                    border: `1px solid ${record.correct ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
                  }}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold mb-1" style={{ color: "rgba(255,215,0,0.6)" }}>
                        ${record.clue.value} · Q{i + 1}
                      </p>
                      <p className="text-white/80 text-sm mb-2 leading-snug">
                        {stripHtml(record.clue.question)}
                      </p>
                      {!record.correct && (
                        <p className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>
                          Your answer:{" "}
                          <span className="text-red-400">&ldquo;{record.userAnswer}&rdquo;</span>
                        </p>
                      )}
                      <p className="text-xs font-semibold">
                        Answer:{" "}
                        <span style={{ color: record.correct ? "#86efac" : "#fca5a5" }}>
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

            <button onClick={loadCategory}
              className="w-full py-4 rounded font-black uppercase text-lg tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer"
              style={{ backgroundColor: "#FFD700", color: "#060CE9", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
              Play Another Category
            </button>

            <div className="text-center mt-5">
              <Link href="/" className="text-sm hover:underline"
                style={{ color: "rgba(255,215,0,0.55)" }}>
                ← Back to Home
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ─── Question / Feedback ───────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <Header userEmail={userEmail} sessionScore={sessionScore}
        muted={muted} onToggleMute={toggleMute} />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-xl">
          {/* Progress dots */}
          <div className="flex justify-between items-center mb-4 px-1">
            <p className="text-xs font-bold uppercase tracking-widest"
              style={{ color: "rgba(255,215,0,0.6)" }}>
              Question {currentIndex + 1} of {totalQuestions}
            </p>
            <div className="flex gap-2">
              {category.clues.map((_, i) => (
                <div key={i} className="w-2.5 h-2.5 rounded-full transition-colors"
                  style={{
                    backgroundColor:
                      i < currentIndex
                        ? answers[i]?.correct ? "#86efac" : "#f87171"
                        : i === currentIndex ? "#FFD700"
                        : "rgba(255,255,255,0.2)",
                  }} />
              ))}
            </div>
          </div>

          {/* Clue card */}
          <div className="rounded-lg p-8 mb-5 text-center flex flex-col items-center justify-center"
            style={{ backgroundColor: "#040a9e", border: "2px solid #FFD700", minHeight: "200px" }}>
            <p className="text-xs font-black uppercase tracking-widest mb-2"
              style={{ color: "rgba(255,215,0,0.65)" }}>
              {category.title}
            </p>
            <p className="text-3xl font-black mb-5"
              style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
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
                  style={{ backgroundColor: "#040a9e", border: "1px solid rgba(255,215,0,0.4)" }}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!userInput.trim()}
                  className="px-6 py-3 rounded font-black uppercase text-sm tracking-wide transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
                  style={{ backgroundColor: "#FFD700", color: "#060CE9", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                  Submit
                </button>
              </div>
              <p className="text-xs mt-2 text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                Press Enter to submit
              </p>
            </div>
          )}

          {/* Feedback */}
          {gameState === "feedback" && lastResult && (
            <div className="rounded-lg p-5"
              style={{
                backgroundColor: lastResult.correct ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                border: `1px solid ${lastResult.correct ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}`,
              }}>
              <div className="flex items-start gap-3 mb-3">
                <span className="text-3xl leading-none">{lastResult.correct ? "✓" : "✗"}</span>
                <div>
                  <p className="font-black text-lg leading-tight"
                    style={{ color: lastResult.correct ? "#86efac" : "#f87171" }}>
                    {lastResult.correct ? "Correct!" : "Incorrect"}
                  </p>
                  {lastResult.correct && lastResult.matchType === "fuzzy" && (
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                      Close enough — fuzzy match accepted
                    </p>
                  )}
                  {lastResult.correct && lastResult.matchType === "token" && (
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                      Partial match accepted
                    </p>
                  )}
                </div>
              </div>

              {!lastResult.correct && (
                <p className="text-sm mb-2" style={{ color: "rgba(255,255,255,0.6)" }}>
                  You answered:{" "}
                  <span className="text-red-400 font-semibold">
                    &ldquo;{answers[answers.length - 1]?.userAnswer}&rdquo;
                  </span>
                </p>
              )}

              <p className="text-sm font-semibold text-white">
                Answer:{" "}
                <span style={{ color: "#FFD700" }}>{stripHtml(currentClue!.answer)}</span>
              </p>

              <button onClick={handleNext}
                className="w-full mt-4 py-3 rounded font-black uppercase text-sm tracking-wide transition-all hover:opacity-90 cursor-pointer"
                style={{ backgroundColor: "#FFD700", color: "#060CE9", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                {currentIndex < totalQuestions - 1 ? "Next Question →" : "See Results →"}
              </button>
              <p className="text-xs mt-2 text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                Press Enter to continue
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
