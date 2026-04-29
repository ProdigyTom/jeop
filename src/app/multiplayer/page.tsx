"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function MultiplayerHub() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");

  function handleCreate() {
    const code = generateCode();
    router.push(`/multiplayer/${code}?host=1`);
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setJoinError("Please enter a valid game code.");
      return;
    }
    router.push(`/multiplayer/${code}`);
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#060CE9" }}>
      {/* Header */}
      <header className="w-full px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,215,0,0.2)" }}>
        <Link href="/">
          <span className="text-2xl font-black uppercase"
            style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
            Jeopardy!
          </span>
        </Link>
        <Link href="/" className="text-sm hover:underline" style={{ color: "rgba(255,215,0,0.6)" }}>
          ← Back
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <p className="text-xs font-bold uppercase tracking-[0.3em] mb-3"
          style={{ color: "rgba(255,215,0,0.6)" }}>
          Multiplayer
        </p>
        <h1 className="text-5xl sm:text-6xl font-black uppercase mb-12"
          style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif",
            textShadow: "3px 3px 0px #c8a800" }}>
          Play Together
        </h1>

        <div className="w-full max-w-md flex flex-col gap-6">
          {/* Create */}
          <div className="rounded-lg p-8 text-center"
            style={{ backgroundColor: "#040a9e", border: "2px solid #FFD700" }}>
            <h2 className="text-xl font-black uppercase mb-2"
              style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
              Create a Game
            </h2>
            <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.6)" }}>
              Start a new game and invite friends with a code.
            </p>
            <button
              onClick={handleCreate}
              className="w-full py-4 rounded font-black uppercase text-lg tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer"
              style={{ backgroundColor: "#FFD700", color: "#060CE9",
                fontFamily: "Impact, 'Arial Black', sans-serif" }}>
              Create Game
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px" style={{ backgroundColor: "rgba(255,215,0,0.2)" }} />
            <span className="text-sm font-bold" style={{ color: "rgba(255,215,0,0.4)" }}>OR</span>
            <div className="flex-1 h-px" style={{ backgroundColor: "rgba(255,215,0,0.2)" }} />
          </div>

          {/* Join */}
          <div className="rounded-lg p-8"
            style={{ backgroundColor: "#040a9e", border: "2px solid rgba(255,215,0,0.4)" }}>
            <h2 className="text-xl font-black uppercase mb-2 text-center"
              style={{ color: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
              Join a Game
            </h2>
            <p className="text-sm mb-6 text-center" style={{ color: "rgba(255,255,255,0.6)" }}>
              Enter the code from your host.
            </p>
            <form onSubmit={handleJoin} className="flex flex-col gap-3">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(""); }}
                placeholder="ENTER CODE"
                maxLength={8}
                className="w-full px-4 py-3 rounded text-center text-2xl font-black tracking-[0.4em] text-white placeholder-white/25 outline-none focus:ring-2 focus:ring-yellow-400"
                style={{ backgroundColor: "#060CE9", border: "1px solid rgba(255,215,0,0.4)",
                  fontFamily: "Impact, 'Arial Black', sans-serif" }}
              />
              {joinError && (
                <p className="text-sm text-center" style={{ color: "#f87171" }}>{joinError}</p>
              )}
              <button
                type="submit"
                className="w-full py-4 rounded font-black uppercase text-lg tracking-wide transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer border-2 text-white"
                style={{ borderColor: "#FFD700", fontFamily: "Impact, 'Arial Black', sans-serif" }}>
                Join Game
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
