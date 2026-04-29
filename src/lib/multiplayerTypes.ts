// ─── Shared types for multiplayer game ────────────────────────────────────────

export interface MultiplayerClue {
  id: number;
  question: string;
  answer: string;
  value: number;
  category: string;
}

export interface MultiplayerSettings {
  rounds: number;        // 1–5
  questionsPerRound: number; // 3–10
  finalJeopardy: boolean;
}

export interface Player {
  id: string;           // random UUID generated on join
  name: string;
  score: number;
  isHost: boolean;
  isWatcher: boolean;   // host chose watch mode
  connected: boolean;
}

export interface PlayerAnswer {
  playerId: string;
  answer: string;
  correct: boolean;
  earned: number;       // dollar amount earned (0 if wrong)
  timeMs: number;       // ms elapsed when submitted
}

export type GamePhase =
  | "lobby"
  | "starting"          // countdown before first question
  | "question"          // question is live, accepting answers
  | "question_results"  // showing all player answers
  | "leaderboard"       // end-of-round leaderboard
  | "fj_category"       // final jeopardy category reveal + wagering
  | "fj_question"       // final jeopardy question
  | "fj_results"        // final jeopardy answer reveal
  | "game_over";

export interface GameState {
  code: string;
  phase: GamePhase;
  settings: MultiplayerSettings;
  players: Player[];
  // Current question context (set during question/question_results phases)
  currentRound: number;         // 1-indexed
  currentQuestionIndex: number; // 0-indexed within round
  currentClue: MultiplayerClue | null;
  questionStartTime: number | null; // Date.now() when question went live
  answers: PlayerAnswer[];
  // All pre-fetched questions: rounds[roundIndex][questionIndex]
  allClues: MultiplayerClue[][];
  // Final jeopardy
  fjClue: MultiplayerClue | null;
  fjWagers: Record<string, number>; // playerId → wager amount
}

// ─── Realtime broadcast event payloads ────────────────────────────────────────

export interface FJResult {
  playerId: string;
  answer: string;
  wager: number;
  correct: boolean;
  earned: number; // positive if correct, negative if wrong
}

export type BroadcastEvent =
  | { type: "player_joined"; player: Player }
  | { type: "player_left"; playerId: string }
  | { type: "player_reconnected"; playerId: string }
  | { type: "game_started"; state: GameState }
  | { type: "question_reveal"; clue: MultiplayerClue; round: number; questionIndex: number; startTime: number }
  | { type: "player_answer"; playerId: string; answer: string; timeMs: number }
  | { type: "question_end"; answers: PlayerAnswer[]; players: Player[] }
  | { type: "leaderboard"; players: Player[]; isLastRound: boolean }
  | { type: "fj_category_reveal"; clue: MultiplayerClue }
  | { type: "fj_wager"; playerId: string; wager: number }
  | { type: "fj_question_reveal"; startTime: number }
  | { type: "fj_answer"; playerId: string; answer: string }
  | { type: "fj_end"; answers: PlayerAnswer[]; players: Player[] }
  | { type: "game_over"; players: Player[] };
