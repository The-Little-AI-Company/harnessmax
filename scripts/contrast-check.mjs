#!/usr/bin/env node
// Checks every theme in design.md against WCAG 2.2 contrast thresholds.
// Usage: node contrast-check.mjs [path/to/design.md or colors.css] [--md]
// Accepts minified blocks: the last declaration before } needs no semicolon.
// Exit code 1 when any pair fails. --md prints a Markdown table.
// One source of truth: the CSS blocks inside design.md. Do not put values here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const md = args.includes("--md");
const file = args.find((a) => !a.startsWith("--")) ?? join(here, "design.md");
const css = readFileSync(file, "utf8");

// Pairs to verify. Each names a foreground token, a background token, the
// minimum ratio, and the WCAG criterion that sets it.
const pairs = [
  ["--text-strong", "--surface-page", 7, "1.4.6 AAA text"],
  ["--text-body", "--surface-page", 7, "1.4.6 AAA text"],
  ["--text-secondary", "--surface-page", 4.5, "1.4.3 AA text"],
  ["--text-muted", "--surface-page", 4.5, "1.4.3 AA text"],
  ["--text-strong", "--surface-tint", 7, "1.4.6 AAA text"],
  ["--text-body", "--surface-tint", 7, "1.4.6 AAA text"],
  ["--text-muted", "--surface-tint", 4.5, "1.4.3 AA text"],
  ["--link", "--surface-page", 4.5, "1.4.3 AA text"],
  ["--link", "--surface-tint", 4.5, "1.4.3 AA text"],
  ["--on-accent", "--accent", 4.5, "1.4.3 AA text"],
  ["--rule-strong", "--surface-page", 3, "1.4.11 non-text"],
  ["--focus-ring", "--surface-page", 3, "1.4.11 non-text"],
  ["--focus-ring", "--surface-tint", 3, "1.4.11 non-text"],
  ["--status-ok", "--surface-page", 4.5, "1.4.3 AA text"],
  ["--status-stop", "--surface-page", 4.5, "1.4.3 AA text"],
];

// Split the CSS into theme blocks. `:root` is reported as "default" and
// every named theme inherits from it.
const blocks = new Map();
const blockRe = /(:root|\[data-theme="([a-z-]+)"\])\s*\{([^}]*)\}/g;
for (const m of css.matchAll(blockRe)) {
  const name = m[2] ?? "default";
  const vars = blocks.get(name) ?? {};
  for (const v of m[3].matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})(?=\s*(?:;|$|\}))/g)) {
    vars[v[1]] = v[2];
  }
  blocks.set(name, vars);
}
if (blocks.size === 0) {
  console.error(`No :root or [data-theme] blocks with hex tokens found in ${file}`);
  process.exit(2);
}
const base = blocks.get("default") ?? {};

function lin(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let failed = 0;
const rows = [];
for (const [theme, own] of blocks) {
  const vars = { ...base, ...own };
  for (const [fg, bg, min, why] of pairs) {
    if (!vars[fg] || !vars[bg]) {
      rows.push([theme, fg, bg, "missing", min, why, "FAIL"]);
      failed++;
      continue;
    }
    const r = ratio(vars[fg], vars[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    rows.push([theme, fg, bg, r.toFixed(2), min, why, ok ? "pass" : "FAIL"]);
  }
}

if (md) {
  console.log("| Theme | Foreground | Background | Ratio | Minimum | Criterion | Result |");
  console.log("|---|---|---|---:|---:|---|---|");
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
} else {
  for (const r of rows) console.log(r.join("\t"));
}
console.log(`\n${rows.length - failed} pass, ${failed} fail, ${blocks.size} themes, file ${file}`);
process.exit(failed ? 1 : 0);
