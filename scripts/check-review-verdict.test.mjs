import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assessReview as assessWithFiles } from "./check-review-verdict.mjs";

const ciEvidence = { run_id: 42, conclusion: "success", jobs: [
  { name: "checks", conclusion: "success", steps: [
    { name: "Script tests", conclusion: "success" }, { name: "Contrast", conclusion: "success" },
    { name: "Install", conclusion: "skipped" },
  ] },
] };
const complete = {
  verdict: "pass",
  review_status: "complete",
  summary: "Inspected the contract guard and its tests. Both union branches are covered and no defects were found.",
  reviewed_files: ["src/contract/types.ts", "src/contract/types.test.ts"],
  inspection: [
    { file: "src/contract/types.ts", observation: "The rule-presence guard narrows both union members." },
    { file: "src/contract/types.test.ts", observation: "Both runtime guard branches have assertions." },
  ],
  verification: { ci_run_id: 42, steps: [{ job: "checks", step: "Script tests" }, { job: "checks", step: "Contrast" }],
    limitations: "Tests ran in CI; the read-only reviewer inspected recorded results." },
  blockers: [],
  findings: [],
};
const finding = { severity: "P1", file: "scripts/check-review-verdict.mjs", line: 1, issue: "Blocked verdicts pass.", fix: "Require a passing verdict." };
const assessReview = (raw) => assessWithFiles(raw, complete.reviewed_files, ciEvidence);
const assess = (value) => assessReview(JSON.stringify(value));

function createGitFixture(directory) {
  const git = (...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  for (const file of complete.reviewed_files) {
    mkdirSync(join(directory, "src/contract"), { recursive: true });
    writeFileSync(join(directory, file), "before\n");
  }
  git("add", ".");
  git("commit", "--quiet", "-m", "Fixture base");
  const base = git("rev-parse", "HEAD");
  for (const file of complete.reviewed_files) writeFileSync(join(directory, file), "after\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "Fixture head");
  return { base, head: git("rev-parse", "HEAD") };
}

test("accepts a justified complete pass without findings", () => {
  assert.equal(assess(complete).passed, true);
});

test("rejects the exact response that incorrectly passed PR 129", () => {
  assert.equal(assessReview('{"verdict":"block","findings":[]}').passed, false);
  assert.equal(assess({ ...complete, verdict: "block" }).passed, false);
});

test("rejects findings even when the verdict says pass", () => {
  for (const verdict of ["pass", "block"]) assert.equal(assess({ ...complete, verdict, findings: [finding] }).passed, false);
});

test("rejects incomplete inspection and retains its explanation", () => {
  const incomplete = { ...complete, verdict: "block", review_status: "incomplete", reviewed_files: [],
    summary: "I could not inspect repository files because no shell or file tools were available.",
    blockers: ["Available tools were limited to MCP resource inventory, which returned no files."] };
  assert.equal(assess(incomplete).passed, false);
  assert.equal(assess(incomplete).review.summary, incomplete.summary);
  assert.equal(assess({ ...incomplete, verdict: "pass" }).passed, false);
  assert.ok(assess({ ...incomplete, blockers: [] }).errors.some((error) => error.includes("explain")));
});

test("requires a justification and inspection evidence", () => {
  for (const summary of ["", "   ", null, 12]) assert.equal(assess({ ...complete, summary }).passed, false);
  assert.equal(assess({ ...complete, reviewed_files: [] }).passed, false);
  assert.equal(assess({ ...complete, blockers: ["Could not read a changed file."] }).passed, false);
  assert.equal(assess({ ...complete, reviewed_files: [complete.reviewed_files[0]] }).passed, false);
  assert.equal(assessWithFiles(JSON.stringify(complete), []).passed, false);
  assert.equal(assessWithFiles(JSON.stringify(complete)).passed, false);
  assert.equal(assessWithFiles(JSON.stringify(complete), [...complete.reviewed_files, "deleted.txt"]).passed, false);
});

test("rejects placeholder-only reviews and missing or invented verification evidence", () => {
  const { inspection, verification, ...legacy } = complete;
  assert.equal(assess({ ...legacy, summary: "x" }).passed, false);
  for (const changes of [
    { inspection: [] }, { inspection: inspection.slice(1) },
    { inspection: [{ ...inspection[0], observation: " " }, inspection[1]] },
    { verification: { ...verification, ci_run_id: 99 } },
    { verification: { ...verification, steps: [] } },
    { verification: { ...verification, steps: verification.steps.slice(1) } },
    { verification: { ...verification, steps: [...verification.steps, { job: "checks", step: "Install" }] } },
    { verification: { ...verification, limitations: " " } },
  ]) assert.equal(assess({ ...complete, ...changes }).passed, false);
  assert.equal(assessWithFiles(JSON.stringify(complete), complete.reviewed_files).passed, false);
  assert.equal(assessWithFiles(JSON.stringify(complete), complete.reviewed_files, { ...ciEvidence, conclusion: "failure" }).passed, false);
});

test("rejects invalid JSON and incomplete or unexpected response shapes", () => {
  for (const raw of ["", "not JSON", "null", "[]"]) assert.equal(assessReview(raw).passed, false);
  for (const key of Object.keys(complete)) {
    const value = { ...complete };
    delete value[key];
    assert.equal(assess(value).passed, false, key);
  }
  for (const value of [
    { ...complete, verdict: "approve" }, { ...complete, review_status: "done" },
    { ...complete, findings: {} }, { ...complete, findings: [null] },
    { ...complete, findings: [{ ...finding, severity: "P3" }] },
    { ...complete, findings: [{ ...finding, line: 0 }] },
    { ...complete, findings: [{ ...finding, line: 1.5 }] },
    { ...complete, findings: [{ ...finding, fix: "" }] },
    { ...complete, reviewed_files: [12] }, { ...complete, extra: true },
  ]) assert.equal(assess(value).passed, false);
});

test("the token-bearing comment action safely posts justified and malformed responses without importing PR code", async () => {
  const workflow = readFileSync(new URL("../.github/workflows/codex-review.yml", import.meta.url), "utf8");
  const step = workflow.split("- name: Post the review as a comment")[1].split("- name: Enforce review verdict")[0];
  const script = step.split("script: |")[1].split("\n").map((line) => line.replace(/^            /, "")).join("\n");
  const run = new (Object.getPrototypeOf(async function () {}).constructor)("github", "context", "process", script);
  assert.ok(!/\b(import|require)\s*\(/.test(script));
  for (const raw of [JSON.stringify(complete), '</pre><script>bad & text</script>\n```', "null", "", '{"findings":{}}']) {
    let posted;
    await run({ rest: { issues: { createComment: async (payload) => { posted = payload; } } } },
      { repo: { owner: "test", repo: "repo" }, payload: { pull_request: { number: 130 } } },
      { env: { CODEX_VERDICT: raw } });
    assert.equal(posted.issue_number, 130);
    assert.ok(posted.body.includes(raw.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")));
    assert.ok(!posted.body.includes("<script>"));
    if (raw === JSON.stringify(complete)) assert.ok(posted.body.includes(complete.summary));
  }
});

test("the workflow invokes the tested gate and reports failures before rejecting", () => {
  const workflow = readFileSync(new URL("../.github/workflows/codex-review.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes('node scripts/check-review-verdict.mjs verdict.json'));
  assert.ok(workflow.indexOf("Post the review as a comment") < workflow.indexOf("Enforce review verdict"));
  assert.ok(workflow.includes("--sandbox read-only"));
  assert.ok(workflow.includes("environment: codex-review"));
  assert.ok(workflow.includes("--json"));
});

test("the reviewer receives successful GitHub CI evidence only for its exact commit", async () => {
  const workflow = readFileSync(new URL("../.github/workflows/codex-review.yml", import.meta.url), "utf8");
  const step = workflow.split("- name: Read successful CI evidence for this commit")[1].split("- name: Seed the Codex home")[0];
  const script = step.split("script: |")[1].split("\n").map((line) => line.replace(/^            /, "")).join("\n");
  const runScript = new (Object.getPrototypeOf(async function () {}).constructor)("github", "context", "process", "core", script);
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.ok(ci.includes('run-name: CI PR${{ github.event.pull_request.number || 0 }} ${{ github.event.pull_request.base.sha || github.event.before }}...${{ github.event.pull_request.head.sha || github.sha }}'));
  assert.ok(ci.includes('ref: ${{ github.sha }}'));
  const association = { number: 131, head: { sha: "expected" }, base: { sha: "base" } };
  const success = { id: 42, head_sha: "expected", conclusion: "success", html_url: "https://example.test/run/42", display_title: "CI PR131 base...expected", pull_requests: [association] };
  // GitHub updates embedded PR metadata on historical runs. It cannot make
  // an old event title valid for the new base, even when the head is unchanged.
  const oldBase = { ...success, display_title: "CI PR131 old-base...expected" };
  for (const runs of [[success], [oldBase, success], [oldBase],
    [{ ...success, display_title: "CI PR129 base...expected" }],
    [{ ...success, display_title: undefined }],
    [{ ...success, head_sha: "old" }], [{ ...success, conclusion: "failure" }], []]) {
    let evidence;
    const run = runScript({ rest: { actions: {
      listWorkflowRuns: async (args) => {
        assert.equal(args.workflow_id, "ci.yml");
        assert.equal(args.head_sha, "expected");
        return { data: { workflow_runs: runs } };
      }, listJobsForWorkflowRun: () => {},
    } }, paginate: async () => [{ name: "checks", conclusion: "success", steps: [{ name: "Script tests", conclusion: "success" }] }] },
    { repo: { owner: "test", repo: "repo" } }, { env: { REVIEW_HEAD_SHA: "expected", REVIEW_BASE_SHA: "base", REVIEW_PR_NUMBER: "131" } },
    { setOutput: (name, value) => { assert.equal(name, "evidence"); evidence = JSON.parse(value); } });
    if (runs.includes(success)) {
      await run;
      assert.equal(evidence.head_sha, "expected");
      assert.equal(evidence.base_sha, "base");
      assert.equal(evidence.pr_number, 131);
      assert.equal(evidence.jobs[0].steps[0].conclusion, "success");
    } else {
      await assert.rejects(run, /No successful CI run/);
      assert.equal(evidence, undefined);
    }
  }
});

test("the actual workflow shell requires both a valid pass and a successful review job", { skip: process.platform === "win32" }, () => {
  const workflow = readFileSync(new URL("../.github/workflows/codex-review.yml", import.meta.url), "utf8");
  const step = workflow.split("- name: Enforce review verdict")[1].split("  fork-guard:")[0];
  const command = step.split("run: |")[1].split("\n").map((line) => line.replace(/^          /, "")).join("\n");
  const directory = mkdtempSync(join(tmpdir(), "review-workflow-"));
  const repository = fileURLToPath(new URL("../", import.meta.url));
  try {
    // Use the workflow's command verbatim; copy its relative script path into
    // an isolated working directory so verdict.json never dirties the checkout.
    cpSync(join(repository, "scripts"), join(directory, "scripts"), { recursive: true });
    cpSync(join(repository, ".github/codex"), join(directory, ".github/codex"), { recursive: true });
    const { base, head } = createGitFixture(directory);
    const reviewEnvironment = { ...process.env, REVIEW_BASE_SHA: base, REVIEW_HEAD_SHA: head, REVIEW_CI_EVIDENCE: JSON.stringify(ciEvidence) };
    for (const [raw, job, status] of [
      [JSON.stringify(complete), "success", 0],
      [JSON.stringify(complete), "failure", 1],
      [JSON.stringify(complete), "cancelled", 1],
      [JSON.stringify(complete), "skipped", 1],
      ['{"verdict":"block","findings":[]}', "success", 1],
      ["invalid", "success", 1],
      ["", "failure", 1],
    ]) {
      const result = spawnSync("bash", ["-e", "-c", command], {
        cwd: directory, encoding: "utf8", env: { ...reviewEnvironment, CODEX_VERDICT: raw, REVIEW_RESULT: job },
      });
      assert.equal(result.status, status, result.stdout + result.stderr);
    }
    for (const file of ["scripts/check-review-verdict.mjs", ".github/codex/review-schema.json"]) {
      const path = join(directory, file);
      const original = readFileSync(path, "utf8");
      writeFileSync(path, file.endsWith(".mjs") ? "process.exit(0);\n" : "{}\n");
      const result = spawnSync("bash", ["-e", "-c", command], {
        cwd: directory, encoding: "utf8", env: { ...reviewEnvironment, CODEX_VERDICT: JSON.stringify(complete), REVIEW_RESULT: "success" },
      });
      assert.equal(result.status, 1, `Changed policy must fail before executing: ${file}`);
      assert.ok(result.stdout.includes(`${file}: FAILED`));
      writeFileSync(path, original);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("the reviewer shell exports raw output while preserving CLI failure", { skip: process.platform === "win32" }, () => {
  const workflow = readFileSync(new URL("../.github/workflows/codex-review.yml", import.meta.url), "utf8");
  const step = workflow.split("- name: Run Codex on this pull request's diff")[1].split("- name: Say whether the login refreshed itself")[0];
  const command = step.split("run: |")[1].split("\n").map((line) => line.replace(/^          /, "")).join("\n");
  const directory = mkdtempSync(join(tmpdir(), "review-run-"));
  try {
    mkdirSync(join(directory, "bin"));
    cpSync(new URL("../.github/codex", import.meta.url), join(directory, ".github/codex"), { recursive: true });
    writeFileSync(join(directory, "bin/corepack"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(directory, "bin/pnpm"), `#!/bin/sh
shift 2
while [ "$1" = "-c" ]; do shift 2; done
action="$1"
shift
if [ "$action" = "features" ]; then printf 'shell_tool stable true\\nunified_exec stable true\\n'; exit 0; fi
if [ "$action" = "sandbox" ]; then
  # Pinned Codex chooses the platform itself; a platform name is not a subcommand.
  [ "$1" = "--" ] || exit 64
  exit "$PREFLIGHT_STATUS"
fi
[ "$action" = "exec" ] || exit 64
if [ "$WRITE_VERDICT" = "true" ]; then printf '%s' "$FIXTURE" > "$RUNNER_TEMP/verdict.json"; fi
printf '{"type":"thread.started","thread_id":"fixture"}\\n'
exit "$CLI_STATUS"
`, { mode: 0o755 });
    for (const [raw, cliStatus, write, preflightStatus, status] of [
      [JSON.stringify(complete), "0", "true", "0", 0],
      ['{"verdict":"block","findings":[]}', "0", "true", "0", 0],
      ["malformed", "0", "true", "0", 0],
      [JSON.stringify(complete), "7", "true", "0", 7],
      ["", "0", "false", "0", 1],
      ["", "0", "false", "2", 2],
    ]) {
      const runner = mkdtempSync(join(directory, "runner-"));
      const output = join(runner, "output");
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", command], {
        cwd: directory, encoding: "utf8", env: { ...process.env, PATH: `${join(directory, "bin")}:${process.env.PATH}`,
          RUNNER_TEMP: runner, GITHUB_OUTPUT: output, FIXTURE: raw, CLI_STATUS: cliStatus, WRITE_VERDICT: write, PREFLIGHT_STATUS: preflightStatus },
      });
      assert.equal(result.status, status, result.stdout + result.stderr);
      if (preflightStatus !== "0") {
        assert.throws(() => readFileSync(join(runner, "review-events.jsonl")), { code: "ENOENT" });
        continue;
      }
      const exported = readFileSync(output, "utf8");
      const delimiter = exported.split("\n")[0].slice("verdict<<".length);
      assert.equal(exported, `verdict<<${delimiter}\n${raw}\n${delimiter}\n`);
      assert.ok(readFileSync(join(runner, "review-events.jsonl"), "utf8").includes('"thread.started"'));
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("the command exits nonzero for a blocked, invalid, or missing response", () => {
  const directory = mkdtempSync(join(tmpdir(), "review-verdict-"));
  const file = join(directory, "verdict.json");
  const script = fileURLToPath(new URL("./check-review-verdict.mjs", import.meta.url));
  try {
    const { base, head } = createGitFixture(directory);
    const range = `${base}...${head}`;
    for (const [raw, status] of [[JSON.stringify(complete), 0], ['{"verdict":"block","findings":[]}', 1], ["invalid", 1]]) {
      writeFileSync(file, raw);
      const result = spawnSync(process.execPath, [script, file, range], { cwd: directory, encoding: "utf8", env: { ...process.env, REVIEW_CI_EVIDENCE: JSON.stringify(ciEvidence) } });
      assert.equal(result.status, status, result.stdout + result.stderr);
    }
    assert.equal(spawnSync(process.execPath, [script, join(directory, "missing.json"), range], { cwd: directory }).status, 1);
    assert.equal(spawnSync(process.execPath, [script, file, "missing...HEAD"], { cwd: directory }).status, 1);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
