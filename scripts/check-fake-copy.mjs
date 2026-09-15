#!/usr/bin/env node
/**
 * Static truthfulness guard.
 *
 * This repo's history includes several real incidents of hardcoded/fabricated
 * data or copy presented as if it were live (a 250-row synthetic seed archive,
 * fake demo API keys, "responding at 98ms" provider-health claims, a
 * Premium/Fallback sourcing label derived from an inert settings field, and a
 * "Screening Filter Conditions" popup with numbers that never matched the
 * actual rules engine). Each was found and fixed once. This script is the
 * regression guard: it fails the build if any of those exact phrases, or the
 * removed symbols/files that produced them, reappear anywhere in the source.
 *
 * This is deliberately NOT a general profanity/banned-word linter — every
 * entry below is tied to a specific, previously-real defect. Add to this list
 * whenever a new "looked real but wasn't" defect is found and fixed, so it
 * can never silently come back.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['src', 'server'];
const EXTENSIONS = new Set(['.ts', '.tsx']);

// [pattern, why it's banned]
const BANNED = [
  [/RAW_FIXTURE_POOL/, 'the old hardcoded 9-fixture fake data pool'],
  [/generateFullHistoricalDataset/, 'the old synthetic 250-row Archive generator'],
  [/BASE_MATCHES/, 'the 50 fake match templates behind the old Archive generator'],
  [/SEED_HISTORICAL_BETS/, 'the old fabricated seed archive'],
  [/SEED_SYNC_LOGS/, 'the old fabricated seed sync logs'],
  [/KNOWN_OFFICIAL_RESULTS/, 'the old hardcoded fake match-result lookup'],
  [/SR-B2B-DEMO-2026-KEY/, 'the old fake default Sportradar demo key'],
  [/SM-FALLBACK-B2B-77491/, 'the old fake default Sportmonks demo key'],
  [/responding at 98ms/i, 'a fabricated fixed-latency provider health claim'],
  [/PREMIUM_FLASHSCORE|FALLBACK_SPORTRADAR|FALLBACK_SPORTMONKS|PREMIUM_TENNIS_ABSTRACT/, 'the retired fake Premium/Fallback provider-tier framing'],
  [/providerIsFallback/, 'the retired fake Premium/Fallback provider field'],
  [/Premium \(direct\)|Fallback \(B2B\)/, 'the retired fake Premium/Fallback sourcing label'],
  [/Rules locked/, 'the old "filters are fixed" claim — thresholds are now user-configurable'],
  [/≥75% of last 8 domestic matches/, 'fabricated filter numbers that never matched rulesEngine.ts'],
  [/expected goals rate ≥2\.40/, 'a fabricated filter number with no corresponding real rule'],
  [/ranking gap ≥40 spots/, 'a fabricated filter number with no corresponding real rule'],
  [/Over 1\.5 &ge;1\.15, Under 3\.5/, 'a hardcoded price-floor claim that ignores configured Filter Thresholds'],
];

/** Files that may legitimately reference a banned phrase (e.g. this file, or a changelog). */
const ALLOWLIST = new Set(['scripts/check-fake-copy.mjs']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = full.slice(ROOT.length);
    if (ALLOWLIST.has(rel)) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
    } else if (EXTENSIONS.has(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

// Historical-note comments referencing a retired symbol by name (e.g. "the
// old KNOWN_OFFICIAL_RESULTS map") are fine — they're documentation, not a
// live reappearance. Only code lines matter here, so comments are stripped
// (a crude but sufficient block-then-line comment strip for this purpose)
// before matching. This means a violation hidden entirely inside a comment
// would be missed — an acceptable tradeoff for a lint-style guard, not a
// substitute for the e2e tests actually exercising the app.
function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

let violations = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const code = stripComments(readFileSync(file, 'utf-8'));
    const lines = code.split('\n');
    for (const [pattern, reason] of BANNED) {
      lines.forEach((line, i) => {
        if (pattern.test(line)) {
          violations.push({ file: file.slice(ROOT.length), line: i + 1, pattern: pattern.source, reason });
        }
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`\n✗ Truthfulness guard failed — ${violations.length} banned pattern(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  matches /${v.pattern}/`);
    console.error(`    → banned because: ${v.reason}\n`);
  }
  process.exit(1);
}

console.log(`✓ Truthfulness guard passed — no fabricated/placeholder copy found (${SCAN_DIRS.join(', ')}).`);
