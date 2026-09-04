#!/usr/bin/env node
// Checks branch names and commit messages against AGENTS.md.
// Usage: node scripts/check-git.mjs --branch <name>
//        node scripts/check-git.mjs --range <base>..<head>
// Exit code 1 on the first rule that fails. Zero dependencies, so it runs
// before pnpm install and inside CI on a bare runner.

import { execFileSync } from "node:child_process";

const BRANCH = /^(feat|fix|chore|docs|refactor|ci|test|perf)\/[a-z0-9][a-z0-9-]{2,60}$/;
const PROTECTED = new Set(["dev", "prod"]);
const SUBJECT_MAX = 72;
const SUBJECT_MIN = 10;
const THROWAWAY = /^(wip|fixup!|squash!|temp|tmp|test commit)/i;
const LONG_DASH = /[—–]/;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const failures = [];

function checkBranch(name) {
  if (PROTECTED.has(name)) return;
  if (!BRANCH.test(name)) {
    failures.push(`branch "${name}" must match feat/, fix/, chore/, docs/, refactor/, ci/, test/, or perf/ followed by a lowercase slug`);
  }
}

function checkRange(range) {
  const raw = execFileSync("git", ["log", "--format=%H%x00%P%x00%s%x00%b%x01", range], { encoding: "utf8" });
  const commits = raw.split("\x01").map((s) => s.trim()).filter(Boolean);
  if (commits.length === 0) failures.push(`no commits in ${range}`);
  for (const c of commits) {
    const [hash, parents, subject, body = ""] = c.split("\x00");
    const short = hash.slice(0, 7);
    if (parents.trim().split(" ").length > 1) failures.push(`${short} is a merge commit; rebase onto dev instead`);
    if (subject.length > SUBJECT_MAX) failures.push(`${short} subject is ${subject.length} chars, max ${SUBJECT_MAX}`);
    if (subject.length < SUBJECT_MIN) failures.push(`${short} subject "${subject}" is too short to say what changed`);
    if (!/^[A-Z]/.test(subject)) failures.push(`${short} subject must start with a capital letter: "${subject}"`);
    if (/\.$/.test(subject)) failures.push(`${short} subject must not end with a period: "${subject}"`);
    if (THROWAWAY.test(subject)) failures.push(`${short} is a throwaway commit ("${subject}"); squash it locally before the PR`);
    if (LONG_DASH.test(subject) || LONG_DASH.test(body)) failures.push(`${short} contains an em or en dash; use a period, comma, or parentheses`);
  }
  return commits.length;
}

const branch = flag("--branch");
const range = flag("--range");
if (!branch && !range) {
  console.error("usage: check-git.mjs --branch <name> | --range <base>..<head>");
  process.exit(2);
}
if (branch) checkBranch(branch);
let count = 0;
if (range) count = checkRange(range);

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log(`ok${branch ? ` branch ${branch}` : ""}${range ? ` ${count} commits in ${range}` : ""}`);
