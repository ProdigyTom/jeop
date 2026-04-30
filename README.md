# Jeopardy!

A Jeopardy! practice app built with Next.js, powered by thousands of real archive questions.

## Features

- **Solo play** — pick a category and answer questions one at a time with immediate feedback
- **Score tracking** — sign in to track your correct/total ratio across sessions
- **Multiplayer** — compete with up to 10 players in real-time (no account required)
- **Smart answer matching** — handles misspellings, articles, Jeopardy phrasing, ordinals, Roman numerals, and partial answers

## Multiplayer

Create a game and share the 6-character code (or QR code) with friends. Up to 10 players can join anonymously — no login needed.

**Game settings (host configures before starting):**
- 1–5 rounds
- 3–10 questions per round
- Final Jeopardy on/off
- Watch mode — host spectates instead of playing

**Scoring** — full value for answers within 10 seconds, decaying to 25% minimum by 30 seconds.

**Flow:**
1. Host creates game → players join via code
2. Each round: questions revealed one at a time, all players answer simultaneously
3. Per-question results shown after each answer phase
4. Leaderboard shown between rounds
5. Optional Final Jeopardy: 20s wager phase → 60s question phase → reveal

Players who disconnect miss those questions (scored as wrong) but can rejoin and continue.

## Stack

- **Framework**: Next.js 16 (App Router, TypeScript)
- **Styling**: Tailwind CSS v4
- **Database / Auth**: Supabase (Postgres + Realtime Broadcast)
- **Hosting**: Vercel
- **Questions**: J! Archive via internal Supabase `clues` table

## Getting Started

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in your Supabase project URL and anon key.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```
