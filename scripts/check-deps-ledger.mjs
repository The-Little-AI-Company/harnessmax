#!/usr/bin/env node
// Checks package.json against DEPENDENCIES.md, the dependency ledger.
// Usage: node scripts/check-deps-ledger.mjs
// Every dependency and devDependency must have a row under "## Installed"
// in the ledger, and every ledger row must still be in package.json. Exit
// code 1 on any drift. Zero dependencies.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const ledgerPath = join(root, "DEPENDENCIES.md");

if (!existsSync(pkgPath)) {
  console.log("ok no package.json yet, nothing to check");
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const installed = new Map();
for (const kind of ["dependencies", "devDependencies"]) {
  for (const [name, version] of Object.entries(pkg[kind] ?? {})) installed.set(name, { kind, version });
}

const ledger = readFileSync(ledgerPath, "utf8");
const section = ledger.split(/^## Installed\s*$/m)[1]?.split(/^## /m)[0] ?? "";
const rows = new Map();
for (const line of section.split("\n")) {
  const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
  if (m) rows.set(m[1], line);
}

const failures = [];
for (const [name, { kind, version }] of installed) {
  if (!rows.has(name)) failures.push(`${name} (${kind} ${version}) is in package.json but not in DEPENDENCIES.md`);
  else if (/[\^~*]|latest/.test(version)) failures.push(`${name} is not pinned: "${version}"`);
}
for (const name of rows.keys()) {
  if (!installed.has(name)) failures.push(`${name} is in DEPENDENCIES.md but not in package.json; delete the row`);
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log(`ok ${installed.size} dependencies match the ledger`);
