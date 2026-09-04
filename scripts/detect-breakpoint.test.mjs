import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { globToRegex, loadPatterns, matches } from "./detect-breakpoint.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shipped = loadPatterns(readFileSync(join(root, ".github/codex/breakpoints.txt"), "utf8"));

test("double star matches any depth including none", () => {
  const re = globToRegex("src/sandbox/**");
  assert.ok(re.test("src/sandbox/a/b/c.ts"));
  assert.ok(re.test("src/sandbox/pod.ts"));
  assert.ok(!re.test("src/sandboxes/pod.ts"));
});

test("single star stays within one segment", () => {
  const re = globToRegex("src/workspace/*-folder.ts");
  assert.ok(re.test("src/workspace/tauri-folder.ts"));
  assert.ok(!re.test("src/workspace/deep/tauri-folder.ts"));
});

test("a dot in the pattern is literal", () => {
  assert.ok(globToRegex(".env.schema").test(".env.schema"));
  assert.ok(!globToRegex(".env.schema").test("xenvxschema"));
});

test("the shipped list catches every boundary the plan names", () => {
  const files = [
    "src/receipts/write.ts", "src/sandbox/run.ts", "src/agent/runner.ts", "src/gates/rules.ts",
    "src/mcp/server.ts", "src/workspace/folder.ts", "src/workspace/tauri-folder.ts",
    "src/contract/schema.ts", "src-tauri/src/main.rs", ".github/workflows/ci.yml",
    ".github/codex/breakpoints.txt", "scripts/check-git.mjs", "package.json", "pnpm-lock.yaml",
    "DEPENDENCIES.md", ".env.schema",
  ];
  assert.deepEqual(matches(files, shipped), files);
});

test("the shipped list ignores screens, docs, and tokens", () => {
  const files = ["README.md", "src/components/Button.tsx", "src/styles/tokens/colors.css", "docs/contract.md", "src/app/shell.tsx"];
  assert.deepEqual(matches(files, shipped), []);
});
