import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const schema = JSON.parse(readFileSync(new URL("../.github/codex/review-schema.json", import.meta.url), "utf8"));

// Validate the JSON Schema keywords used by the review response contract.
function validate(value, rule, path, errors) {
  const types = {
    object: () => value !== null && typeof value === "object" && !Array.isArray(value),
    array: () => Array.isArray(value),
    string: () => typeof value === "string",
    integer: () => Number.isInteger(value),
  };
  if (!types[rule.type]?.()) {
    errors.push(`${path} must be ${rule.type}`);
    return;
  }
  if (rule.enum && !rule.enum.includes(value)) errors.push(`${path} has an unknown value`);
  if (rule.type === "string" && rule.minLength && value.trim().length < rule.minLength) errors.push(`${path} must not be blank`);
  if (rule.type === "integer" && rule.minimum !== undefined && value < rule.minimum) errors.push(`${path} must be at least ${rule.minimum}`);
  if (rule.type === "array") value.forEach((item, index) => validate(item, rule.items, `${path}[${index}]`, errors));
  if (rule.type === "object") {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(rule.properties, key)) validate(item, rule.properties[key], `${path}.${key}`, errors);
      else if (rule.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
    }
  }
}

export function assessReview(raw, changedFiles, ciEvidence) {
  let review;
  try {
    review = JSON.parse(raw);
  } catch {
    return { passed: false, review: null, errors: ["The reviewer returned no valid JSON response."] };
  }
  const errors = [];
  validate(review, schema, "review", errors);
  if (errors.length) return { passed: false, review: null, errors };

  if (review.review_status === "incomplete") {
    errors.push("The reviewer did not complete inspection.");
    if (!review.blockers.length) errors.push("An incomplete review must explain its execution blocker.");
  }
  if (review.review_status === "complete" && !review.reviewed_files.length) errors.push("A complete review must name the files inspected.");
  if (!Array.isArray(changedFiles) || !changedFiles.length) errors.push("The changed-file set is missing or empty.");
  else {
    const inspected = new Set(review.reviewed_files);
    for (const path of changedFiles) if (!inspected.has(path)) errors.push(`Changed file was not inspected: ${path}`);
    const observations = new Set(review.inspection.map(item => item.file));
    for (const path of changedFiles) if (!observations.has(path)) errors.push(`Missing inspection observation: ${path}`);
    for (const path of observations) if (!inspected.has(path)) errors.push(`Observation names an uninspected file: ${path}`);
  }
  if (!ciEvidence || ciEvidence.conclusion !== "success" || !Number.isInteger(ciEvidence.run_id) || !Array.isArray(ciEvidence.jobs)) {
    errors.push("Successful workflow-supplied CI evidence is required.");
  } else {
    if (review.verification.ci_run_id !== ciEvidence.run_id) errors.push("Verification cites a different CI run.");
    const stepKey = (job, step) => JSON.stringify([job, step]);
    const expected = new Set(ciEvidence.jobs.filter(job => job.conclusion === "success").flatMap(job =>
      job.steps.filter(step => step.conclusion === "success").map(step => stepKey(job.name, step.name))));
    const cited = new Set(review.verification.steps.map(item => stepKey(item.job, item.step)));
    if (!expected.size) errors.push("CI evidence has no successful steps.");
    for (const key of expected) if (!cited.has(key)) errors.push(`Missing CI step evidence: ${key}`);
    for (const key of cited) if (!expected.has(key)) errors.push(`Unverified CI step claimed: ${key}`);
  }
  if (review.blockers.length) errors.push("The review has unresolved execution blockers.");
  if (review.verdict !== "pass") errors.push("The reviewer returned a blocked verdict.");
  if (review.findings.length) errors.push(`The review contains ${review.findings.length} finding(s).`);
  return { passed: errors.length === 0, review, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const range = process.argv[3];
  if (!file || !range) {
    console.error("Usage: node scripts/check-review-verdict.mjs <verdict.json> <base...head>");
    process.exitCode = 2;
  } else {
    try {
      const changedFiles = execFileSync("git", ["diff", "--name-only", "-z", range, "--"], { encoding: "utf8" }).split("\0").filter(Boolean);
      const result = assessReview(readFileSync(file, "utf8"), changedFiles, JSON.parse(process.env.REVIEW_CI_EVIDENCE || "null"));
      console.log(result.passed ? "ok complete review passed with no findings" : result.errors.join("\n"));
      process.exitCode = result.passed ? 0 : 1;
    } catch (error) {
      console.error(`Cannot check review response: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
