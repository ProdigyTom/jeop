#!/usr/bin/env node
/**
 * Jeopardy! Clue Importer — Seasons 20–41
 *
 * Prerequisites:
 *   1. Run the SQL in the README to create the `clues` and `categories` tables
 *   2. Add SUPABASE_SERVICE_ROLE_KEY to .env.local
 *
 * Usage:
 *   node scripts/import-clues.mjs
 *
 * To re-run from scratch, truncate the tables first:
 *   TRUNCATE clues, categories RESTART IDENTITY;
 */

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ───────────────────────────────────────────────────────────

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "\n❌  Missing env vars. Ensure .env.local contains:\n" +
      "    NEXT_PUBLIC_SUPABASE_URL\n" +
      "    SUPABASE_SERVICE_ROLE_KEY\n"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Config ────────────────────────────────────────────────────────────────────

const FIRST_SEASON = 20;
const LAST_SEASON = 41;
const BATCH_SIZE = 2000;
const BASE_URL =
  "https://raw.githubusercontent.com/jwolle1/jeopardy_clue_dataset/main/seasons";

// ── Stream TSV from URL, yield one line at a time ─────────────────────────────

async function* streamLines(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let leftover = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (leftover.trim()) yield leftover;
      break;
    }
    const chunk = leftover + decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");
    leftover = lines.pop(); // last chunk may be incomplete
    for (const line of lines) {
      if (line.trim()) yield line;
    }
  }
}

// ── Insert a batch of clue rows ───────────────────────────────────────────────

async function insertBatch(rows) {
  const { error } = await supabase.from("clues").insert(rows);
  if (error) throw new Error(error.message);
}

// ── Import one season, return clue count and category counts ──────────────────

async function importSeason(season, categoryCounts) {
  const url = `${BASE_URL}/season${season}.tsv`;
  process.stdout.write(`  Season ${season}: connecting...`);

  let headers = null;
  let batch = [];
  let rowCount = 0;

  for await (const line of streamLines(url)) {
    // First line is the header
    if (!headers) {
      headers = line.split("\t");
      continue;
    }

    const cols = line.split("\t");
    const get = (col) => cols[headers.indexOf(col)]?.trim() ?? "";

    const round = get("round");
    // Skip Final Jeopardy and Tiebreakers — they can't form a 5-clue set
    if (round === "FJ!" || round === "TB") continue;

    const category = get("category");
    const answer = get("answer"); // the clue text shown on the board
    const question = get("question"); // the correct response
    const clueValue = parseInt(get("clue_value")) || null;
    const airDate = get("air_date") || null;

    if (!category || !answer || !question) continue;

    batch.push({
      category,
      clue_value: clueValue,
      answer,
      question,
      air_date: airDate,
    });

    // Track category counts for the categories table
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch);
      rowCount += batch.length;
      batch = [];
      process.stdout.write(
        `\r  Season ${season}: ${rowCount.toLocaleString()} clues inserted...`
      );
    }
  }

  if (batch.length > 0) {
    await insertBatch(batch);
    rowCount += batch.length;
  }

  process.stdout.write(
    `\r  Season ${season}: ✓ ${rowCount.toLocaleString()} clues\n`
  );
  return rowCount;
}

// ── Populate categories table from accumulated counts ─────────────────────────

async function populateCategories(categoryCounts) {
  // Only include categories with at least 5 clues (a full playable set)
  const rows = [...categoryCounts.entries()]
    .filter(([, count]) => count >= 5)
    .map(([name, clue_count]) => ({ name, clue_count }));

  process.stdout.write(
    `  Inserting ${rows.length.toLocaleString()} categories...`
  );

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("categories")
      .insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Categories insert: ${error.message}`);
  }

  process.stdout.write(`\r  ✓ ${rows.length.toLocaleString()} categories\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🎯  Jeopardy! Clue Importer — Seasons ${FIRST_SEASON}–${LAST_SEASON}\n`);

  const categoryCounts = new Map();
  let total = 0;

  for (let season = FIRST_SEASON; season <= LAST_SEASON; season++) {
    try {
      total += await importSeason(season, categoryCounts);
    } catch (err) {
      console.error(`  Season ${season}: ✗ ${err.message}`);
    }
  }

  console.log(`\n📦  Total clues: ${total.toLocaleString()}`);
  console.log(`\n🗂   Building categories table...`);

  try {
    await populateCategories(categoryCounts);
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
  }

  console.log("\n✅  Import complete!\n");
}

main().catch((err) => {
  console.error("\n❌ ", err.message);
  process.exit(1);
});
