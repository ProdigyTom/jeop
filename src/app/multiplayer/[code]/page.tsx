"use client";

import { use, useEffect, useRef, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { checkAnswer } from "@/lib/answerUtils";
import type {
  Player, MultiplayerClue, MultiplayerSettings, PlayerAnswer, FJResult,
} from "@/lib/multiplayerTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

const QUESTION_TIME_MS = 30_000;
const FULL_VALUE_TIME_MS = 10_000;
const FJ_WAGER_TIME_MS = 20_000;
const FJ_QUESTION_TIME_MS = 60_000;
const MAX_PLAYERS = 10;
const DEFAULT_SETTINGS: MultiplayerSettings = { rounds: 2, questionsPerRound: 5, finalJeopardy: false };

// ─── Types ────────────────────────────────────────────────────────────────────

type PagePhase =
  | "loading" | "settings" | "name_entry" | "lobby" | "starting"
  | "question" | "question_results" | "leaderboard"
  | "fj_category" | "fj_question" | "fj_results" | "game_over";

type PresencePayload = Omit<Player, "id"> & { presence_ref?: string };

interface GameStateRef {
  allClues: MultiplayerClue[][];
  fjClue: MultiplayerClue | null;
  players: Player[];
  currentClue: MultiplayerClue | null;
  round: number;
  questionIndex: number;
  pendingAnswers: Map<string, { answer: string; timeMs: number }>;
  fjPendingWagers: Map<string, number>;
  fjPendingAnswers: Map<string, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreatePlayerId(code: string): string {
  const key = `jeop-pid-${code}`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

function computeEarned(value: number, timeMs: number): number {
  if (timeMs <= FULL_VALUE_TIME_MS) return value;
  const decaySec = Math.min(timeMs / 1000 - 10, 20);
  return Math.round(value * Math.max(0.25, 1 - (decaySec / 20) * 0.75));
}

function formatDollars(n: number): string {
  return n < 0 ? `-$${Math.abs(n).toLocaleString()}` : `$${n.toLocaleString()}`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

// ─── Shared UI ────────────────────────────────────────────────────────────────

function PageHeader({ code }: { code: string }) {
  return (
    <header className="w-full px-6 py-3 flex justify-between items-center flex-shrink-0"
      style={{ borderBottom: "1px solid rgba(255,215,0,0.2)" }}>
      <Link href="/">
        <span className="text-2xl font-black uppercase"
          style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
          Jeopardy!
        </span>
      </Link>
      <span className="text-sm font-bold tracking-[0.2em]" style={{ color: "rgba(255,215,0,0.5)" }}>
        {code}
      </span>
    </header>
  );
}

function PillSelector({ label, options, value, onChange }: {
  label: string; options: number[]; value: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest mb-2"
        style={{ color: "rgba(255,215,0,0.6)" }}>{label}</p>
      <div className="flex gap-2 flex-wrap">
        {options.map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)}
            className="px-4 py-2 rounded font-black text-sm uppercase tracking-wide cursor-pointer"
            style={{
              backgroundColor: value === n ? "#FFD700" : "rgba(255,215,0,0.1)",
              color: value === n ? "#060CE9" : "rgba(255,215,0,0.7)",
              border: `1px solid ${value === n ? "#FFD700" : "rgba(255,215,0,0.25)"}`,
            }}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ label, description, value, onChange }: {
  label: string; description?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-lg cursor-pointer"
      style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,215,0,0.15)" }}
      onClick={() => onChange(!value)}>
      <div>
        <p className="text-white font-semibold text-sm">{label}</p>
        {description && <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{description}</p>}
      </div>
      <div className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors"
        style={{ backgroundColor: value ? "#FFD700" : "rgba(255,255,255,0.15)" }}>
        <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
          style={{ left: value ? "calc(100% - 1.25rem - 2px)" : "2px" }} />
      </div>
    </div>
  );
}

function PlayerList({ players, highlightId }: { players: Player[]; highlightId: string }) {
  return (
    <div className="flex flex-col gap-2">
      {players.map((p, i) => (
        <div key={p.id} className="flex items-center justify-between px-4 py-3 rounded-lg"
          style={{
            backgroundColor: p.id === highlightId ? "rgba(255,215,0,0.1)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${p.id === highlightId ? "rgba(255,215,0,0.4)" : "rgba(255,255,255,0.08)"}`,
          }}>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold w-5 text-center" style={{ color: "rgba(255,215,0,0.5)" }}>
              {i + 1}
            </span>
            <span className="text-white font-semibold text-sm">{p.name}</span>
          </div>
          <div className="flex gap-2 items-center">
            {p.isHost && <span className="text-xs px-2 py-0.5 rounded font-bold"
              style={{ backgroundColor: "rgba(255,215,0,0.15)", color: "#FFD700" }}>HOST</span>}
            {p.isWatcher && <span className="text-xs px-2 py-0.5 rounded font-bold"
              style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}>WATCHING</span>}
            <span className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: p.connected ? "#4ade80" : "#f87171" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TimerBar({ startTime, totalMs }: { startTime: number; totalMs: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startTime);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startTime), 100);
    return () => clearInterval(id);
  }, [startTime]);
  const pct = Math.min(elapsed / totalMs, 1);
  const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
  const color = pct < 0.5 ? "#4ade80" : pct < 0.8 ? "#FFD700" : "#f87171";
  return (
    <div>
      <div className="text-4xl font-black text-center mb-2 tabular-nums" style={{ color }}>{remaining}</div>
      <div className="w-full h-2 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.1)" }}>
        <div className="h-2 rounded-full transition-all duration-100"
          style={{ width: `${(1 - pct) * 100}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function WaitingSpinner({ label }: { label: string }) {
  return (
    <div className="text-center py-4">
      <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
      <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>{label}</p>
    </div>
  );
}

// ─── Host Settings ────────────────────────────────────────────────────────────

function HostSettingsScreen({ code, settings, onSettingsChange, onCreateLobby }: {
  code: string; settings: MultiplayerSettings;
  onSettingsChange: (s: MultiplayerSettings) => void; onCreateLobby: (watcher: boolean) => void;
}) {
  const [watcherMode, setWatcherMode] = useState(false);
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <PageHeader code={code} />
      <main className="flex-1 flex flex-col items-center px-4 py-8 overflow-y-auto">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-black uppercase mb-1 text-center"
            style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
            Game Settings
          </h1>
          <p className="text-sm text-center mb-8" style={{ color: "rgba(255,255,255,0.5)" }}>
            Share code <span className="font-bold tracking-widest"
              style={{ color: "rgba(255,215,0,0.8)" }}>{code}</span> once the lobby is open.
          </p>
          <div className="rounded-lg p-6 flex flex-col gap-6"
            style={{ backgroundColor: "#040a9e", border: "2px solid rgba(255,215,0,0.3)" }}>
            <PillSelector label="Rounds" options={[1,2,3,4,5]} value={settings.rounds}
              onChange={(v) => onSettingsChange({ ...settings, rounds: v })} />
            <PillSelector label="Questions per Round" options={[3,4,5,6,7,8,9,10]}
              value={settings.questionsPerRound}
              onChange={(v) => onSettingsChange({ ...settings, questionsPerRound: v })} />
            <ToggleRow label="Final Jeopardy"
              description="Players wager their earnings on one last question."
              value={settings.finalJeopardy}
              onChange={(v) => onSettingsChange({ ...settings, finalJeopardy: v })} />
            <ToggleRow label="Watch Mode"
              description="You host from a shared screen without playing."
              value={watcherMode} onChange={setWatcherMode} />
          </div>
          <div className="mt-4 px-4 py-3 rounded text-xs"
            style={{ backgroundColor: "rgba(255,215,0,0.07)", color: "rgba(255,215,0,0.6)" }}>
            {settings.rounds} round{settings.rounds > 1 ? "s" : ""} · {settings.questionsPerRound} questions
            each · {settings.rounds * settings.questionsPerRound} total
            {settings.finalJeopardy ? " + Final Jeopardy" : ""}
          </div>
          <button onClick={() => onCreateLobby(watcherMode)}
            className="w-full mt-6 py-4 rounded font-black uppercase text-xl tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer"
            style={{ backgroundColor: "#FFD700", color: "#060CE9",
              fontFamily: "Impact, 'Arial Black', sans-serif" }}>
            Open Lobby
          </button>
          <div className="text-center mt-4">
            <Link href="/multiplayer" className="text-sm hover:underline"
              style={{ color: "rgba(255,215,0,0.4)" }}>← Back</Link>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function LobbyScreen({ code, isHost, isWatcher, players, settings, playerId, onStartGame, isStarting }: {
  code: string; isHost: boolean; isWatcher: boolean; players: Player[];
  settings: MultiplayerSettings; playerId: string; onStartGame: () => void; isStarting: boolean;
}) {
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/multiplayer/${code}` : "";
  const activePlayers = players.filter((p) => !p.isWatcher);
  const canStart = isHost && activePlayers.length >= 2 && !isStarting;
  const slotsLeft = MAX_PLAYERS - players.length;
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <PageHeader code={code} />
      <main className="flex-1 flex flex-col items-center px-4 py-6 overflow-y-auto">
        <div className="w-full max-w-xl flex flex-col gap-5">
          {isHost ? (
            <div className="rounded-lg p-5 flex flex-col sm:flex-row gap-5 items-center"
              style={{ backgroundColor: "#040a9e", border: "2px solid #FFD700" }}>
              <div className="flex-shrink-0 p-3 rounded-lg" style={{ backgroundColor: "#FFD700" }}>
                <QRCodeSVG value={joinUrl} size={120} bgColor="#FFD700" fgColor="#040a9e" level="M" />
              </div>
              <div className="flex flex-col items-center sm:items-start gap-3 flex-1">
                <p className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: "rgba(255,215,0,0.6)" }}>Share this code</p>
                <div className="text-4xl font-black tracking-[0.3em] cursor-pointer select-all"
                  style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}
                  onClick={() => navigator.clipboard.writeText(code).catch(() => {})}>
                  {code}
                </div>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                  or scan QR · {slotsLeft > 0 ? `${slotsLeft} slot${slotsLeft !== 1 ? "s" : ""} left` : "Full"}
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-xs font-bold uppercase tracking-widest mb-1"
                style={{ color: "rgba(255,215,0,0.6)" }}>Game Code</p>
              <p className="text-4xl font-black tracking-[0.3em]"
                style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>{code}</p>
            </div>
          )}

          <div className="rounded-lg p-5"
            style={{ backgroundColor: "#040a9e", border: "1px solid rgba(255,215,0,0.25)" }}>
            <div className="flex justify-between items-center mb-3">
              <p className="text-xs font-bold uppercase tracking-widest"
                style={{ color: "rgba(255,215,0,0.6)" }}>Players in Lobby</p>
              <span className="text-xs font-bold" style={{ color: "rgba(255,255,255,0.35)" }}>
                {players.length} / {MAX_PLAYERS}
              </span>
            </div>
            {players.length === 0
              ? <p className="text-sm text-center py-4" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Waiting for players to join…
                </p>
              : <PlayerList players={players} highlightId={playerId} />}
          </div>

          <div className="rounded-lg px-5 py-4"
            style={{ backgroundColor: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.15)" }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-2"
              style={{ color: "rgba(255,215,0,0.5)" }}>Game Settings</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>
              <span>{settings.rounds} round{settings.rounds > 1 ? "s" : ""}</span>
              <span>{settings.questionsPerRound} questions / round</span>
              {settings.finalJeopardy && <span>+ Final Jeopardy</span>}
              {isWatcher && <span>Host watching</span>}
            </div>
          </div>

          {isHost ? (
            <div>
              {!canStart && !isStarting && (
                <p className="text-xs text-center mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Need at least 2 players to start.
                </p>
              )}
              <button onClick={onStartGame} disabled={!canStart}
                className="w-full py-4 rounded font-black uppercase text-xl tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] disabled:opacity-30 disabled:scale-100 cursor-pointer"
                style={{ backgroundColor: "#FFD700", color: "#060CE9",
                  fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                {isStarting ? "Starting…" : "Start Game"}
              </button>
            </div>
          ) : (
            <WaitingSpinner label="Waiting for the host to start…" />
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Watcher Question View ────────────────────────────────────────────────────

function WatcherQuestionView({ clue, round, questionIndex, totalQuestions, startTime,
  gamePlayers, answeredPlayerIds }: {
  clue: MultiplayerClue; round: number; questionIndex: number; totalQuestions: number;
  startTime: number; gamePlayers: Player[]; answeredPlayerIds: Set<string>;
}) {
  const activePlayers = gamePlayers.filter((p) => !p.isWatcher);
  const sortedByScore = [...activePlayers].sort((a, b) => b.score - a.score);
  const answeredCount = activePlayers.filter((p) => answeredPlayerIds.has(p.id)).length;

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <header className="w-full px-6 py-3 flex justify-between items-center flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,215,0,0.2)" }}>
        <span className="text-sm font-bold" style={{ color: "rgba(255,215,0,0.6)" }}>
          Round {round} · Q{questionIndex + 1}/{totalQuestions}
        </span>
        <span className="text-base font-black"
          style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
          {clue.category}
        </span>
        <span className="text-sm font-bold" style={{ color: "rgba(255,215,0,0.6)" }}>
          {answeredCount}/{activePlayers.length} answered
        </span>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 px-6 py-6 overflow-y-auto">
        {/* Left: Timer + Question */}
        <div className="flex flex-col gap-5">
          <TimerBar startTime={startTime} totalMs={QUESTION_TIME_MS} />
          <div className="rounded-lg p-8 flex flex-col items-center justify-center text-center"
            style={{ backgroundColor: "#040a9e", border: "2px solid #FFD700", minHeight: "200px" }}>
            <p className="text-4xl font-black mb-4"
              style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
              {formatDollars(clue.value)}
            </p>
            <p className="text-white text-xl leading-relaxed">{clue.question}</p>
          </div>
        </div>

        {/* Right: Player status + live scores */}
        <div className="flex flex-col gap-4">
          <div className="rounded-lg p-4"
            style={{ backgroundColor: "#040a9e", border: "1px solid rgba(255,215,0,0.25)" }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3"
              style={{ color: "rgba(255,215,0,0.6)" }}>Player Status</p>
            <div className="grid grid-cols-2 gap-2">
              {activePlayers.map((p) => {
                const answered = answeredPlayerIds.has(p.id);
                return (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded transition-all"
                    style={{
                      backgroundColor: answered ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${answered ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.08)"}`,
                    }}>
                    <span className="text-base flex-shrink-0">{answered ? "✓" : "⏳"}</span>
                    <span className="text-sm font-semibold truncate"
                      style={{ color: answered ? "#86efac" : "rgba(255,255,255,0.6)" }}>
                      {p.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg p-4"
            style={{ backgroundColor: "#040a9e", border: "1px solid rgba(255,215,0,0.25)" }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3"
              style={{ color: "rgba(255,215,0,0.6)" }}>Current Scores</p>
            <div className="flex flex-col gap-1.5">
              {sortedByScore.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded"
                  style={{ backgroundColor: i === 0 ? "rgba(255,215,0,0.08)" : "transparent" }}>
                  <span className="text-sm w-5 text-center font-bold"
                    style={{ color: i === 0 ? "#FFD700" : "rgba(255,255,255,0.3)" }}>
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm font-semibold text-white truncate">{p.name}</span>
                  <span className="text-sm font-black"
                    style={{ color: i === 0 ? "#FFD700" : "rgba(255,255,255,0.7)" }}>
                    {formatDollars(p.score)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Question Screen ──────────────────────────────────────────────────────────

function QuestionScreen({ clue, round, questionIndex, totalQuestions, startTime,
  hasAnswered, answerInput, onAnswerChange, onSubmit, isWatcher, gamePlayers, answeredCount }: {
  clue: MultiplayerClue; round: number; questionIndex: number; totalQuestions: number;
  startTime: number; hasAnswered: boolean; answerInput: string;
  onAnswerChange: (v: string) => void; onSubmit: () => void;
  isWatcher: boolean; gamePlayers: Player[]; answeredCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activePlayers = gamePlayers.filter((p) => !p.isWatcher);
  const waitingCount = activePlayers.length - answeredCount;

  useEffect(() => {
    if (!hasAnswered && !isWatcher) setTimeout(() => inputRef.current?.focus(), 50);
  }, [hasAnswered, isWatcher]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <header className="w-full px-6 py-3 flex justify-between items-center flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,215,0,0.2)" }}>
        <span className="text-sm font-bold" style={{ color: "rgba(255,215,0,0.6)" }}>
          Round {round} · Q{questionIndex + 1}/{totalQuestions}
        </span>
        <span className="text-sm font-bold" style={{ color: "rgba(255,215,0,0.6)" }}>
          {formatDollars(clue.value)}
        </span>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6">
        <div className="w-full max-w-xl flex flex-col gap-5">
          <TimerBar startTime={startTime} totalMs={QUESTION_TIME_MS} />

          <div>
            <h2 className="text-center text-2xl sm:text-3xl font-black uppercase mb-3"
              style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif",
                letterSpacing: "0.05em" }}>
              {clue.category}
            </h2>
            <div className="rounded-lg p-8 text-center flex flex-col items-center justify-center"
              style={{ backgroundColor: "#040a9e", border: "2px solid #FFD700", minHeight: "200px" }}>
              <p className="text-white text-lg leading-relaxed">{clue.question}</p>
            </div>
          </div>

          {isWatcher ? (
            <p className="text-sm text-center" style={{ color: "rgba(255,255,255,0.5)" }}>
              {answeredCount} / {activePlayers.length} answered
            </p>
          ) : hasAnswered ? (
            <div className="rounded-lg p-5 text-center"
              style={{ backgroundColor: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.3)" }}>
              <p className="font-black text-lg mb-1" style={{ color: "#FFD700" }}>Answer submitted!</p>
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                {waitingCount > 0 ? `Waiting for ${waitingCount} more player${waitingCount !== 1 ? "s" : ""}…` : "All answers in!"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <input ref={inputRef} type="text" value={answerInput}
                  onChange={(e) => onAnswerChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSubmit()}
                  placeholder="Your answer…"
                  className="flex-1 px-4 py-3 rounded text-white text-lg placeholder-white/35 outline-none focus:ring-2 focus:ring-yellow-400"
                  style={{ backgroundColor: "#040a9e", border: "1px solid rgba(255,215,0,0.4)" }} />
                <button onClick={onSubmit} disabled={!answerInput.trim()}
                  className="px-6 py-3 rounded font-black uppercase text-sm tracking-wide hover:opacity-90 disabled:opacity-40 cursor-pointer"
                  style={{ backgroundColor: "#FFD700", color: "#060CE9",
                    fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                  Submit
                </button>
              </div>
              <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                Press Enter · answer locks in immediately
              </p>
            </div>
          )}

          {!isWatcher && (
            <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.25)" }}>
              {answeredCount} / {activePlayers.length} answered
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Question Results ─────────────────────────────────────────────────────────

function QuestionResultsScreen({ clue, answers, gamePlayers, isHost, onNext, nextLabel }: {
  clue: MultiplayerClue; answers: PlayerAnswer[]; gamePlayers: Player[];
  isHost: boolean; onNext: () => void; nextLabel: string;
}) {
  const playerMap = Object.fromEntries(gamePlayers.map((p) => [p.id, p]));
  const sorted = [...answers].sort((a, b) => b.earned - a.earned);
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <header className="w-full px-6 py-3 flex justify-between items-center flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,215,0,0.2)" }}>
        <span className="text-sm font-bold uppercase tracking-widest"
          style={{ color: "rgba(255,215,0,0.6)" }}>Results</span>
        <span className="text-sm font-black"
          style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
          {clue.category} · {formatDollars(clue.value)}
        </span>
      </header>
      <main className="flex-1 flex flex-col items-center px-4 py-6 overflow-y-auto">
        <div className="w-full max-w-xl flex flex-col gap-4">
          <div className="rounded-lg px-5 py-4 text-center"
            style={{ backgroundColor: "#040a9e", border: "2px solid rgba(255,215,0,0.4)" }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-1"
              style={{ color: "rgba(255,215,0,0.5)" }}>The answer was</p>
            <p className="text-xl font-black"
              style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
              {clue.answer}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {sorted.map((a) => {
              const player = playerMap[a.playerId];
              if (!player) return null;
              return (
                <div key={a.playerId} className="rounded-lg px-5 py-4 flex items-center gap-4"
                  style={{
                    backgroundColor: a.correct ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.08)",
                    border: `1px solid ${a.correct ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.25)"}`,
                  }}>
                  <span className="text-xl flex-shrink-0">{a.correct ? "✓" : "✗"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-white truncate">{player.name}</p>
                    <p className="text-xs mt-0.5 truncate"
                      style={{ color: a.correct ? "rgba(134,239,172,0.8)" : "rgba(255,255,255,0.4)" }}>
                      {a.answer || <em>no answer</em>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-black text-base"
                      style={{ color: a.correct ? "#4ade80" : "rgba(255,255,255,0.3)" }}>
                      {a.correct ? `+${formatDollars(a.earned)}` : "—"}
                    </p>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                      total: {formatDollars(player.score)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {isHost
            ? <button onClick={onNext}
                className="w-full py-4 rounded font-black uppercase text-lg tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer mt-2"
                style={{ backgroundColor: "#FFD700", color: "#060CE9",
                  fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                {nextLabel}
              </button>
            : <WaitingSpinner label="Waiting for host…" />}
        </div>
      </main>
    </div>
  );
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function LeaderboardScreen({ gamePlayers, round, totalRounds, isHost, onNext, nextLabel }: {
  gamePlayers: Player[]; round: number; totalRounds: number;
  isHost: boolean; onNext: () => void; nextLabel: string;
}) {
  const sorted = [...gamePlayers].filter((p) => !p.isWatcher).sort((a, b) => b.score - a.score);
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <header className="w-full px-6 py-3 flex items-center justify-center flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,215,0,0.2)" }}>
        <span className="text-sm font-bold uppercase tracking-widest"
          style={{ color: "rgba(255,215,0,0.6)" }}>
          Round {round} of {totalRounds} Complete
        </span>
      </header>
      <main className="flex-1 flex flex-col items-center px-4 py-8 overflow-y-auto">
        <div className="w-full max-w-xl flex flex-col gap-4">
          <h2 className="text-4xl font-black uppercase text-center mb-2"
            style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif",
              textShadow: "2px 2px 0 #c8a800" }}>
            Leaderboard
          </h2>
          <div className="flex flex-col gap-2">
            {sorted.map((p, i) => (
              <div key={p.id} className="flex items-center gap-4 px-5 py-4 rounded-lg"
                style={{
                  backgroundColor: i === 0 ? "rgba(255,215,0,0.12)" : "#040a9e",
                  border: `2px solid ${i === 0 ? "#FFD700" : "rgba(255,215,0,0.15)"}`,
                }}>
                <span className="text-2xl w-8 text-center flex-shrink-0">
                  {i < 3 ? MEDALS[i] : <span className="font-black text-base"
                    style={{ color: "rgba(255,255,255,0.3)" }}>{i + 1}</span>}
                </span>
                <span className="flex-1 font-bold text-white text-lg truncate">{p.name}</span>
                <span className="font-black text-xl flex-shrink-0"
                  style={{ color: i === 0 ? "#FFD700" : "rgba(255,255,255,0.85)" }}>
                  {formatDollars(p.score)}
                </span>
              </div>
            ))}
          </div>
          {isHost
            ? <button onClick={onNext}
                className="w-full py-4 rounded font-black uppercase text-xl tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer mt-4"
                style={{ backgroundColor: "#FFD700", color: "#060CE9",
                  fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                {nextLabel}
              </button>
            : <WaitingSpinner label="Waiting for host…" />}
        </div>
      </main>
    </div>
  );
}

// ─── Final Jeopardy: Category + Wager ─────────────────────────────────────────

function FJCategoryScreen({ fjClue, gamePlayers, playerId, isWatcher,
  hasWagered, wagerInput, onWagerChange, onSubmitWager, wagerCount, startTime, wageredPlayerIds }: {
  fjClue: MultiplayerClue; gamePlayers: Player[]; playerId: string; isWatcher: boolean;
  hasWagered: boolean; wagerInput: string; onWagerChange: (v: string) => void;
  onSubmitWager: () => void; wagerCount: number; startTime: number; wageredPlayerIds: Set<string>;
}) {
  const myScore = gamePlayers.find((p) => p.id === playerId)?.score ?? 0;
  const maxWager = Math.max(0, myScore);
  const activePlayers = gamePlayers.filter((p) => !p.isWatcher);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ backgroundColor: "#060CE9" }}>
      <p className="text-xs font-bold uppercase tracking-[0.4em] mb-4"
        style={{ color: "rgba(255,215,0,0.6)" }}>Final Jeopardy</p>
      <h1 className="text-5xl sm:text-6xl font-black uppercase mb-8 max-w-2xl leading-tight"
        style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif",
          textShadow: "3px 3px 0 #c8a800" }}>
        {fjClue.category}
      </h1>

      <div className="w-full max-w-sm mb-6">
        <TimerBar startTime={startTime} totalMs={FJ_WAGER_TIME_MS} />
      </div>

      {isWatcher ? (
        <div className="w-full max-w-sm flex flex-col gap-3">
          <p className="text-sm text-center font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>
            {wagerCount} / {activePlayers.length} have wagered
          </p>
          <div className="grid grid-cols-2 gap-2">
            {activePlayers.map((p) => {
              const wagered = wageredPlayerIds.has(p.id);
              return (
                <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded transition-colors"
                  style={{
                    backgroundColor: wagered ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${wagered ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.1)"}`,
                  }}>
                  <span className="text-base flex-shrink-0">{wagered ? "✓" : "⏳"}</span>
                  <span className="text-sm font-semibold truncate"
                    style={{ color: wagered ? "#86efac" : "rgba(255,255,255,0.55)" }}>
                    {p.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : hasWagered ? (
        <div className="rounded-lg p-5"
          style={{ backgroundColor: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.3)" }}>
          <p className="font-black text-lg mb-1" style={{ color: "#FFD700" }}>Wager locked in!</p>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
            {wagerCount} / {activePlayers.length} wagered · waiting for others…
          </p>
        </div>
      ) : (
        <div className="w-full max-w-sm flex flex-col gap-4">
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
            Your score: <span className="font-bold" style={{ color: "#FFD700" }}>{formatDollars(myScore)}</span>
          </p>
          <div className="flex flex-col gap-2">
            <input type="number" value={wagerInput}
              onChange={(e) => onWagerChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSubmitWager()}
              placeholder="Your wager…"
              min={0} max={maxWager}
              className="w-full px-4 py-3 rounded text-white text-xl text-center placeholder-white/30 outline-none focus:ring-2 focus:ring-yellow-400"
              style={{ backgroundColor: "#040a9e", border: "1px solid rgba(255,215,0,0.4)" }} />
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
              Wager $0 – {formatDollars(maxWager)}
            </p>
          </div>
          <button onClick={onSubmitWager}
            className="w-full py-4 rounded font-black uppercase text-lg tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer"
            style={{ backgroundColor: "#FFD700", color: "#060CE9",
              fontFamily: "Impact, 'Arial Black', sans-serif" }}>
            Lock In Wager
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Final Jeopardy: Question ─────────────────────────────────────────────────

function FJQuestionScreen({ fjClue, startTime, hasAnswered, answerInput,
  onAnswerChange, onSubmit, isWatcher, gamePlayers, answeredCount }: {
  fjClue: MultiplayerClue; startTime: number; hasAnswered: boolean; answerInput: string;
  onAnswerChange: (v: string) => void; onSubmit: () => void;
  isWatcher: boolean; gamePlayers: Player[]; answeredCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activePlayers = gamePlayers.filter((p) => !p.isWatcher);
  useEffect(() => {
    if (!hasAnswered && !isWatcher) setTimeout(() => inputRef.current?.focus(), 50);
  }, [hasAnswered, isWatcher]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <header className="w-full px-6 py-3 flex items-center justify-center flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,215,0,0.2)" }}>
        <span className="text-sm font-bold uppercase tracking-widest"
          style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
          Final Jeopardy — {fjClue.category}
        </span>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6">
        <div className="w-full max-w-xl flex flex-col gap-5">
          <TimerBar startTime={startTime} totalMs={FJ_QUESTION_TIME_MS} />

          <div className="rounded-lg p-8 text-center"
            style={{ backgroundColor: "#040a9e", border: "2px solid #FFD700", minHeight: "180px",
              display: "flex", alignItems: "center", justifyContent: "center" }}>
            <p className="text-white text-xl leading-relaxed">{fjClue.question}</p>
          </div>

          {isWatcher ? (
            <p className="text-sm text-center" style={{ color: "rgba(255,255,255,0.5)" }}>
              {answeredCount} / {activePlayers.length} answered
            </p>
          ) : hasAnswered ? (
            <div className="rounded-lg p-5 text-center"
              style={{ backgroundColor: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.3)" }}>
              <p className="font-black text-lg" style={{ color: "#FFD700" }}>Answer submitted!</p>
              <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
                {answeredCount} / {activePlayers.length} answered
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <input ref={inputRef} type="text" value={answerInput}
                  onChange={(e) => onAnswerChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSubmit()}
                  placeholder="Your final answer…"
                  className="flex-1 px-4 py-3 rounded text-white text-lg placeholder-white/35 outline-none focus:ring-2 focus:ring-yellow-400"
                  style={{ backgroundColor: "#040a9e", border: "1px solid rgba(255,215,0,0.4)" }} />
                <button onClick={onSubmit} disabled={!answerInput.trim()}
                  className="px-6 py-3 rounded font-black uppercase text-sm tracking-wide hover:opacity-90 disabled:opacity-40 cursor-pointer"
                  style={{ backgroundColor: "#FFD700", color: "#060CE9",
                    fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                  Submit
                </button>
              </div>
              <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                You have 60 seconds · answer locks in immediately
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Final Jeopardy: Results ──────────────────────────────────────────────────

function FJResultsScreen({ fjClue, results, gamePlayers, isHost, onNext }: {
  fjClue: MultiplayerClue; results: FJResult[]; gamePlayers: Player[];
  isHost: boolean; onNext: () => void;
}) {
  const playerMap = Object.fromEntries(gamePlayers.map((p) => [p.id, p]));
  const sorted = [...results].sort((a, b) =>
    (playerMap[b.playerId]?.score ?? 0) - (playerMap[a.playerId]?.score ?? 0)
  );
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <header className="w-full px-6 py-3 flex items-center justify-center flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,215,0,0.2)" }}>
        <span className="text-sm font-bold uppercase tracking-widest"
          style={{ color: "rgba(255,215,0,0.6)" }}>Final Jeopardy Results</span>
      </header>
      <main className="flex-1 flex flex-col items-center px-4 py-6 overflow-y-auto">
        <div className="w-full max-w-xl flex flex-col gap-4">
          <div className="rounded-lg px-5 py-4 text-center"
            style={{ backgroundColor: "#040a9e", border: "2px solid rgba(255,215,0,0.4)" }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-1"
              style={{ color: "rgba(255,215,0,0.5)" }}>The answer was</p>
            <p className="text-xl font-black"
              style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
              {fjClue.answer}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {sorted.map((r) => {
              const player = playerMap[r.playerId];
              if (!player) return null;
              const gained = r.earned > 0;
              const lost = r.earned < 0;
              return (
                <div key={r.playerId} className="rounded-lg px-5 py-4"
                  style={{
                    backgroundColor: gained ? "rgba(34,197,94,0.1)" : lost ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${gained ? "rgba(34,197,94,0.35)" : lost ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.1)"}`,
                  }}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xl">{r.correct ? "✓" : "✗"}</span>
                    <span className="font-bold text-white">{player.name}</span>
                    <span className="text-xs ml-auto font-bold"
                      style={{ color: gained ? "#4ade80" : lost ? "#f87171" : "rgba(255,255,255,0.4)" }}>
                      {gained ? `+${formatDollars(r.earned)}` : lost ? formatDollars(r.earned) : "±$0"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                    <span>Wagered: {formatDollars(r.wager)} · Answer: {r.answer || <em>none</em>}</span>
                    <span className="font-bold" style={{ color: "rgba(255,215,0,0.8)" }}>
                      {formatDollars(player.score)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {isHost
            ? <button onClick={onNext}
                className="w-full py-4 rounded font-black uppercase text-xl tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer mt-2"
                style={{ backgroundColor: "#FFD700", color: "#060CE9",
                  fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                See Final Results →
              </button>
            : <WaitingSpinner label="Waiting for host…" />}
        </div>
      </main>
    </div>
  );
}

// ─── Game Over ────────────────────────────────────────────────────────────────

function GameOverScreen({ gamePlayers }: { gamePlayers: Player[] }) {
  const sorted = [...gamePlayers].filter((p) => !p.isWatcher).sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  return (
    <div className="min-h-screen flex flex-col items-center justify-start px-4 py-10 overflow-y-auto"
      style={{ backgroundColor: "#060CE9" }}>
      <div className="w-full max-w-xl flex flex-col items-center gap-6">
        <p className="text-xs font-bold uppercase tracking-[0.4em]"
          style={{ color: "rgba(255,215,0,0.6)" }}>Game Complete</p>
        <h1 className="text-6xl sm:text-7xl font-black uppercase text-center leading-none"
          style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif",
            textShadow: "4px 4px 0 #c8a800" }}>
          Game Over!
        </h1>

        {winner && (
          <div className="text-center">
            <p className="text-lg font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>
              Winner: <span className="font-black" style={{ color: "#FFD700" }}>{winner.name}</span>
            </p>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
              with {formatDollars(winner.score)}
            </p>
          </div>
        )}

        <div className="w-full flex flex-col gap-2">
          {sorted.map((p, i) => (
            <div key={p.id} className="flex items-center gap-4 px-5 py-4 rounded-lg"
              style={{
                backgroundColor: i === 0 ? "rgba(255,215,0,0.15)" : "#040a9e",
                border: `2px solid ${i === 0 ? "#FFD700" : i < 3 ? "rgba(255,215,0,0.25)" : "rgba(255,215,0,0.1)"}`,
              }}>
              <span className="text-2xl w-8 text-center flex-shrink-0">
                {i < 3 ? MEDALS[i] : <span className="font-black text-base"
                  style={{ color: "rgba(255,255,255,0.3)" }}>{i + 1}</span>}
              </span>
              <span className="flex-1 font-bold text-white text-lg truncate">{p.name}</span>
              <span className="font-black text-xl flex-shrink-0"
                style={{ color: i === 0 ? "#FFD700" : "rgba(255,255,255,0.85)" }}>
                {formatDollars(p.score)}
              </span>
            </div>
          ))}
        </div>

        <Link href="/multiplayer"
          className="w-full py-4 rounded font-black uppercase text-xl tracking-wide text-center transition-all hover:opacity-90 hover:scale-[1.02]"
          style={{ backgroundColor: "#FFD700", color: "#060CE9",
            fontFamily: "Impact, 'Arial Black', sans-serif" }}>
          Play Again
        </Link>
        <Link href="/" className="text-sm hover:underline" style={{ color: "rgba(255,215,0,0.4)" }}>
          ← Home
        </Link>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MultiplayerGamePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [pagePhase, setPagePhase] = useState<PagePhase>("loading");
  const [isHost, setIsHost] = useState(false);
  const [isWatcher, setIsWatcher] = useState(false);
  const playerId = useMemo(() =>
    typeof window !== "undefined" ? getOrCreatePlayerId(code) : "", [code]);

  // Lobby state
  const [nameInput, setNameInput] = useState("");
  const [settings, setSettings] = useState<MultiplayerSettings>(DEFAULT_SETTINGS);
  const [players, setPlayers] = useState<Player[]>([]);
  const [isStarting, setIsStarting] = useState(false);

  // Game state (render)
  const [gamePlayers, setGamePlayers] = useState<Player[]>([]);
  const [currentClue, setCurrentClue] = useState<MultiplayerClue | null>(null);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState<number | null>(null);
  const [questionAnswers, setQuestionAnswers] = useState<PlayerAnswer[]>([]);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [answerInput, setAnswerInput] = useState("");
  const [answeredCount, setAnsweredCount] = useState(0);
  const [isLastRound, setIsLastRound] = useState(false);

  // Final Jeopardy state
  const [fjClue, setFjClue] = useState<MultiplayerClue | null>(null);
  const [fjWagerStartTime, setFjWagerStartTime] = useState<number | null>(null);
  const [wagerInput, setWagerInput] = useState("");
  const [hasWagered, setHasWagered] = useState(false);
  const [wagerCount, setWagerCount] = useState(0);
  const [fjAnswerInput, setFjAnswerInput] = useState("");
  const [fjHasAnswered, setFjHasAnswered] = useState(false);
  const [fjAnsweredCount, setFjAnsweredCount] = useState(0);
  const [fjResults, setFjResults] = useState<FJResult[]>([]);

  // Watch-mode tracking: which player IDs have answered/wagered (all clients track this)
  const [answeredPlayerIds, setAnsweredPlayerIds] = useState<Set<string>>(new Set());
  const [wageredPlayerIds, setWageredPlayerIds] = useState<Set<string>>(new Set());

  // Refs
  const channelRef = useRef<RealtimeChannel | null>(null);
  const questionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHostRef = useRef(false);
  const isWatcherRef = useRef(false);
  const settingsRef = useRef<MultiplayerSettings>(DEFAULT_SETTINGS);
  const gameStateRef = useRef<GameStateRef>({
    allClues: [], fjClue: null, players: [],
    currentClue: null, round: 1, questionIndex: 0,
    pendingAnswers: new Map(),
    fjPendingWagers: new Map(),
    fjPendingAnswers: new Map(),
  });

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // ── Role detection ──────────────────────────────────────────────────────────
  useEffect(() => {
    const isHostParam = searchParams.get("host") === "1";
    if (isHostParam) sessionStorage.setItem(`jeop-role-${code}`, "host");
    const host = isHostParam || sessionStorage.getItem(`jeop-role-${code}`) === "host";
    isHostRef.current = host;
    setIsHost(host);
    setPagePhase(host ? "settings" : "name_entry");
  }, [code, searchParams]);

  // ── Host broadcast helpers ──────────────────────────────────────────────────

  function clearTimer() {
    if (questionTimerRef.current) { clearTimeout(questionTimerRef.current); questionTimerRef.current = null; }
  }

  function broadcastQuestionEnd() {
    clearTimer();
    const gs = gameStateRef.current;
    if (!gs.currentClue || !channelRef.current) return;
    const updatedPlayers = gs.players.map((p) => ({ ...p }));
    const answerResults: PlayerAnswer[] = [];
    for (const player of updatedPlayers) {
      if (player.isWatcher) continue;
      const submitted = gs.pendingAnswers.get(player.id);
      const rawAnswer = submitted?.answer ?? "";
      const timeMs = submitted?.timeMs ?? QUESTION_TIME_MS;
      const result = checkAnswer(rawAnswer, gs.currentClue.answer);
      const earned = result.correct ? computeEarned(gs.currentClue.value, timeMs) : 0;
      player.score += earned;
      answerResults.push({ playerId: player.id, answer: rawAnswer, correct: result.correct, earned, timeMs });
    }
    gs.players = updatedPlayers;
    channelRef.current.send({
      type: "broadcast", event: "question_end",
      payload: { answers: answerResults, players: updatedPlayers },
    });
  }

  function broadcastNextQuestion(round: number, questionIndex: number) {
    const gs = gameStateRef.current;
    if (!channelRef.current) return;
    const clue = gs.allClues[round - 1]?.[questionIndex];
    if (!clue) return;
    gs.currentClue = clue;
    gs.round = round;
    gs.questionIndex = questionIndex;
    gs.pendingAnswers.clear();
    const startTime = Date.now();
    channelRef.current.send({
      type: "broadcast", event: "question_reveal",
      payload: { clue, round, questionIndex, startTime },
    });
    clearTimer();
    questionTimerRef.current = setTimeout(broadcastQuestionEnd, QUESTION_TIME_MS);
  }

  function broadcastLeaderboard(round: number) {
    if (!channelRef.current) return;
    const isLast = round >= settingsRef.current.rounds;
    channelRef.current.send({
      type: "broadcast", event: "leaderboard",
      payload: { players: gameStateRef.current.players, round, isLastRound: isLast },
    });
  }

  function broadcastFJCategory() {
    const gs = gameStateRef.current;
    if (!channelRef.current) return;
    if (!gs.fjClue) { broadcastGameOver(); return; }
    gs.fjPendingWagers.clear();
    const startTime = Date.now();
    channelRef.current.send({
      type: "broadcast", event: "fj_category_reveal",
      payload: { fjClue: gs.fjClue, startTime },
    });
    clearTimer();
    questionTimerRef.current = setTimeout(broadcastFJQuestion, FJ_WAGER_TIME_MS);
  }

  function broadcastFJQuestion() {
    clearTimer();
    if (!channelRef.current) return;
    const startTime = Date.now();
    gameStateRef.current.fjPendingAnswers.clear();
    channelRef.current.send({
      type: "broadcast", event: "fj_question_reveal",
      payload: { startTime },
    });
    questionTimerRef.current = setTimeout(broadcastFJEnd, FJ_QUESTION_TIME_MS);
  }

  function broadcastFJEnd() {
    clearTimer();
    if (!channelRef.current) return;
    const gs = gameStateRef.current;
    if (!gs.fjClue) return;
    const updatedPlayers = gs.players.map((p) => ({ ...p }));
    const results: FJResult[] = [];
    for (const player of updatedPlayers) {
      if (player.isWatcher) continue;
      const wager = gs.fjPendingWagers.get(player.id) ?? 0;
      const rawAnswer = gs.fjPendingAnswers.get(player.id) ?? "";
      const result = checkAnswer(rawAnswer, gs.fjClue.answer);
      const earned = result.correct ? wager : -wager;
      player.score += earned;
      results.push({ playerId: player.id, answer: rawAnswer, wager, correct: result.correct, earned });
    }
    gs.players = updatedPlayers;
    channelRef.current.send({
      type: "broadcast", event: "fj_end",
      payload: { results, players: updatedPlayers },
    });
  }

  function broadcastGameOver() {
    if (!channelRef.current) return;
    channelRef.current.send({
      type: "broadcast", event: "game_over",
      payload: { players: gameStateRef.current.players },
    });
  }

  // ── Subscribe to channel ────────────────────────────────────────────────────
  function subscribeToChannel(name: string, host: boolean, watcher: boolean) {
    if (channelRef.current) return;
    const channel = supabase.channel(`game:${code}`, {
      config: { presence: { key: playerId }, broadcast: { self: true } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresencePayload>();
      const list: Player[] = Object.entries(state).flatMap(([pid, presences]) =>
        presences.slice(0, 1).map(({ presence_ref: _ref, ...p }) => ({ id: pid, ...p }))
      );
      setPlayers(list);
    });

    channel.on("broadcast", { event: "game_started" }, ({ payload }) => {
      gameStateRef.current.allClues = payload.allClues;
      gameStateRef.current.fjClue = payload.fjClue;
      gameStateRef.current.players = payload.players;
      setGamePlayers(payload.players);
      setPagePhase("starting");
    });

    channel.on("broadcast", { event: "question_reveal" }, ({ payload }) => {
      const { clue, round, questionIndex, startTime } = payload;
      gameStateRef.current.currentClue = clue;
      gameStateRef.current.round = round;
      gameStateRef.current.questionIndex = questionIndex;
      gameStateRef.current.pendingAnswers.clear();
      setCurrentClue(clue);
      setCurrentRound(round);
      setCurrentQuestionIndex(questionIndex);
      setQuestionStartTime(startTime);
      setHasAnswered(false);
      setAnswerInput("");
      setAnsweredCount(0);
      setAnsweredPlayerIds(new Set());
      setQuestionAnswers([]);
      setPagePhase("question");
    });

    channel.on("broadcast", { event: "player_answer" }, ({ payload }) => {
      setAnsweredCount((n) => n + 1);
      setAnsweredPlayerIds((ids) => new Set([...ids, payload.playerId]));
      if (!isHostRef.current) return;
      const gs = gameStateRef.current;
      gs.pendingAnswers.set(payload.playerId, { answer: payload.answer, timeMs: payload.timeMs });
      const activeCount = gs.players.filter((p) => !p.isWatcher).length;
      if (gs.pendingAnswers.size >= activeCount) broadcastQuestionEnd();
    });

    channel.on("broadcast", { event: "question_end" }, ({ payload }) => {
      clearTimer();
      gameStateRef.current.players = payload.players;
      setGamePlayers(payload.players);
      setQuestionAnswers(payload.answers);
      setPagePhase("question_results");
    });

    channel.on("broadcast", { event: "leaderboard" }, ({ payload }) => {
      gameStateRef.current.players = payload.players;
      setGamePlayers(payload.players);
      setCurrentRound(payload.round);
      setIsLastRound(payload.isLastRound);
      setPagePhase("leaderboard");
    });

    channel.on("broadcast", { event: "fj_category_reveal" }, ({ payload }) => {
      gameStateRef.current.fjClue = payload.fjClue;
      gameStateRef.current.fjPendingWagers.clear();
      setFjClue(payload.fjClue);
      setHasWagered(false);
      setWagerInput("");
      setWagerCount(0);
      setWageredPlayerIds(new Set());
      setFjWagerStartTime(payload.startTime);
      setPagePhase("fj_category");
    });

    channel.on("broadcast", { event: "fj_wager" }, ({ payload }) => {
      setWagerCount((n) => n + 1);
      setWageredPlayerIds((ids) => new Set([...ids, payload.playerId]));
      if (!isHostRef.current) return;
      const gs = gameStateRef.current;
      gs.fjPendingWagers.set(payload.playerId, payload.wager);
      const activeCount = gs.players.filter((p) => !p.isWatcher).length;
      if (gs.fjPendingWagers.size >= activeCount) broadcastFJQuestion();
    });

    channel.on("broadcast", { event: "fj_question_reveal" }, ({ payload }) => {
      clearTimer();
      setQuestionStartTime(payload.startTime);
      setFjHasAnswered(false);
      setFjAnswerInput("");
      setFjAnsweredCount(0);
      setPagePhase("fj_question");
    });

    channel.on("broadcast", { event: "fj_answer" }, ({ payload }) => {
      setFjAnsweredCount((n) => n + 1);
      if (!isHostRef.current) return;
      const gs = gameStateRef.current;
      gs.fjPendingAnswers.set(payload.playerId, payload.answer);
      const activeCount = gs.players.filter((p) => !p.isWatcher).length;
      if (gs.fjPendingAnswers.size >= activeCount) broadcastFJEnd();
    });

    channel.on("broadcast", { event: "fj_end" }, ({ payload }) => {
      clearTimer();
      gameStateRef.current.players = payload.players;
      setGamePlayers(payload.players);
      setFjResults(payload.results);
      setPagePhase("fj_results");
    });

    channel.on("broadcast", { event: "game_over" }, ({ payload }) => {
      gameStateRef.current.players = payload.players;
      setGamePlayers(payload.players);
      setPagePhase("game_over");
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ name, score: 0, isHost: host, isWatcher: watcher, connected: true });
        setPagePhase("lobby");
      }
    });

    channelRef.current = channel;
  }

  useEffect(() => () => {
    channelRef.current?.unsubscribe();
    clearTimer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Lobby actions ───────────────────────────────────────────────────────────
  function handleCreateLobby(watcher: boolean) {
    isWatcherRef.current = watcher;
    setIsWatcher(watcher);
    subscribeToChannel("Host", true, watcher);
  }

  function handleJoinLobby(e: React.SyntheticEvent) {
    e.preventDefault();
    const name = nameInput.trim();
    if (!name) return;
    subscribeToChannel(name, false, false);
  }

  // ── Start game ──────────────────────────────────────────────────────────────
  async function handleStartGame() {
    if (!channelRef.current) return;
    setIsStarting(true);
    try {
      const qs = new URLSearchParams({
        rounds: String(settings.rounds),
        perRound: String(settings.questionsPerRound),
        fj: settings.finalJeopardy ? "1" : "0",
      });
      const res = await fetch(`/api/multiplayer/questions?${qs}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const initialPlayers: Player[] = players.map((p) => ({ ...p, score: 0 }));
      gameStateRef.current.allClues = data.rounds;
      gameStateRef.current.fjClue = data.fjClue ?? null;
      gameStateRef.current.players = initialPlayers;
      channelRef.current.send({
        type: "broadcast", event: "game_started",
        payload: { settings, allClues: data.rounds, fjClue: data.fjClue ?? null, players: initialPlayers },
      });
      setTimeout(() => broadcastNextQuestion(1, 0), 2000);
    } catch (err) {
      console.error("Start game failed:", err);
      setIsStarting(false);
    }
  }

  // ── Answer submission ───────────────────────────────────────────────────────
  function handleSubmitAnswer() {
    if (!channelRef.current || !currentClue || hasAnswered || !answerInput.trim()) return;
    const timeMs = Date.now() - (questionStartTime ?? Date.now());
    setHasAnswered(true);
    channelRef.current.send({
      type: "broadcast", event: "player_answer",
      payload: { playerId, answer: answerInput, timeMs },
    });
  }

  function handleSubmitWager() {
    if (!channelRef.current || hasWagered || isWatcher) return;
    const myScore = gamePlayers.find((p) => p.id === playerId)?.score ?? 0;
    const raw = parseInt(wagerInput) || 0;
    const wager = Math.max(0, Math.min(raw, Math.max(0, myScore)));
    setWagerInput(String(wager));
    setHasWagered(true);
    channelRef.current.send({
      type: "broadcast", event: "fj_wager",
      payload: { playerId, wager },
    });
  }

  function handleSubmitFJAnswer() {
    if (!channelRef.current || fjHasAnswered || !fjAnswerInput.trim()) return;
    setFjHasAnswered(true);
    channelRef.current.send({
      type: "broadcast", event: "fj_answer",
      payload: { playerId, answer: fjAnswerInput },
    });
  }

  // ── Host navigation ─────────────────────────────────────────────────────────
  function handleNextFromResults() {
    const gs = gameStateRef.current;
    const nextIndex = gs.questionIndex + 1;
    if (nextIndex < settingsRef.current.questionsPerRound) {
      broadcastNextQuestion(gs.round, nextIndex);
    } else {
      broadcastLeaderboard(gs.round);
    }
  }

  function handleNextFromLeaderboard() {
    const gs = gameStateRef.current;
    const nextRound = gs.round + 1;
    if (nextRound <= settingsRef.current.rounds) {
      broadcastNextQuestion(nextRound, 0);
    } else if (settingsRef.current.finalJeopardy) {
      broadcastFJCategory();
    } else {
      broadcastGameOver();
    }
  }

  function resultsNextLabel() {
    const gs = gameStateRef.current;
    return gs.questionIndex + 1 < settingsRef.current.questionsPerRound
      ? "Next Question →"
      : "See Leaderboard →";
  }

  function leaderboardNextLabel() {
    if (!isLastRound) return "Start Next Round →";
    return settings.finalJeopardy ? "Play Final Jeopardy →" : "See Final Results →";
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (pagePhase === "loading") return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#060CE9" }}>
      <div className="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (pagePhase === "settings") return (
    <HostSettingsScreen code={code} settings={settings} onSettingsChange={setSettings}
      onCreateLobby={handleCreateLobby} />
  );

  if (pagePhase === "name_entry") return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      <PageHeader code={code} />
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <p className="text-xs font-bold uppercase tracking-[0.3em] mb-3"
          style={{ color: "rgba(255,215,0,0.6)" }}>Joining Game</p>
        <h1 className="text-5xl font-black tracking-[0.3em] mb-2"
          style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>{code}</h1>
        <p className="text-sm mb-10" style={{ color: "rgba(255,255,255,0.45)" }}>
          Enter your display name to join
        </p>
        <form onSubmit={handleJoinLobby} className="w-full max-w-sm flex flex-col gap-4">
          <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)}
            placeholder="Your name…" maxLength={20} autoFocus
            className="w-full px-4 py-3 rounded text-white text-lg placeholder-white/30 outline-none focus:ring-2 focus:ring-yellow-400 text-center"
            style={{ backgroundColor: "#040a9e", border: "1px solid rgba(255,215,0,0.4)" }} />
          <button type="submit" disabled={!nameInput.trim()}
            className="w-full py-4 rounded font-black uppercase text-lg tracking-wide transition-all hover:opacity-90 disabled:opacity-40 cursor-pointer"
            style={{ backgroundColor: "#FFD700", color: "#060CE9",
              fontFamily: "Impact, 'Arial Black', sans-serif" }}>
            Join Lobby
          </button>
        </form>
        <Link href="/multiplayer" className="mt-8 text-sm hover:underline"
          style={{ color: "rgba(255,215,0,0.4)" }}>← Back</Link>
      </div>
    </div>
  );

  if (pagePhase === "lobby") return (
    <LobbyScreen code={code} isHost={isHost} isWatcher={isWatcher} players={players}
      settings={settings} playerId={playerId} onStartGame={handleStartGame} isStarting={isStarting} />
  );

  if (pagePhase === "starting") return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ backgroundColor: "#060CE9" }}>
      <div className="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mb-6" />
      <p className="text-2xl font-black uppercase"
        style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
        Game Starting…
      </p>
      <p className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)" }}>Get ready!</p>
    </div>
  );

  if (pagePhase === "question" && currentClue && questionStartTime) {
    if (isWatcher) return (
      <WatcherQuestionView clue={currentClue} round={currentRound}
        questionIndex={currentQuestionIndex} totalQuestions={settings.questionsPerRound}
        startTime={questionStartTime} gamePlayers={gamePlayers}
        answeredPlayerIds={answeredPlayerIds} />
    );
    return (
      <QuestionScreen clue={currentClue} round={currentRound} questionIndex={currentQuestionIndex}
        totalQuestions={settings.questionsPerRound} startTime={questionStartTime}
        hasAnswered={hasAnswered} answerInput={answerInput}
        onAnswerChange={setAnswerInput} onSubmit={handleSubmitAnswer}
        isWatcher={false} gamePlayers={gamePlayers} answeredCount={answeredCount} />
    );
  }

  if (pagePhase === "question_results" && currentClue) return (
    <QuestionResultsScreen clue={currentClue} answers={questionAnswers} gamePlayers={gamePlayers}
      isHost={isHost} onNext={handleNextFromResults} nextLabel={resultsNextLabel()} />
  );

  if (pagePhase === "leaderboard") return (
    <LeaderboardScreen gamePlayers={gamePlayers} round={currentRound} totalRounds={settings.rounds}
      isHost={isHost} onNext={handleNextFromLeaderboard} nextLabel={leaderboardNextLabel()} />
  );

  if (pagePhase === "fj_category" && fjClue && fjWagerStartTime) return (
    <FJCategoryScreen fjClue={fjClue} gamePlayers={gamePlayers} playerId={playerId}
      isWatcher={isWatcher} hasWagered={hasWagered} wagerInput={wagerInput}
      onWagerChange={setWagerInput} onSubmitWager={handleSubmitWager}
      wagerCount={wagerCount} startTime={fjWagerStartTime} wageredPlayerIds={wageredPlayerIds} />
  );

  if (pagePhase === "fj_question" && fjClue && questionStartTime) return (
    <FJQuestionScreen fjClue={fjClue} startTime={questionStartTime}
      hasAnswered={fjHasAnswered} answerInput={fjAnswerInput}
      onAnswerChange={setFjAnswerInput} onSubmit={handleSubmitFJAnswer}
      isWatcher={isWatcher} gamePlayers={gamePlayers} answeredCount={fjAnsweredCount} />
  );

  if (pagePhase === "fj_results" && fjClue) return (
    <FJResultsScreen fjClue={fjClue} results={fjResults} gamePlayers={gamePlayers}
      isHost={isHost} onNext={broadcastGameOver} />
  );

  if (pagePhase === "game_over") return <GameOverScreen gamePlayers={gamePlayers} />;

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#060CE9" }}>
      <div className="w-12 h-12 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
