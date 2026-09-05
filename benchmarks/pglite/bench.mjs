import { readdir, readFile, mkdir, mkdtemp, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { resourceUsage } from "node:process";
import { parseArgs } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import * as tsvector from "./engines/tsvector.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));

// This benchmark retains raw top-level values, including nested YAML text.
// Full YAML validation belongs to the product parser, not the census.
function splitFrontmatter(text) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  if (!match) return { frontmatter: Object.create(null), body: text };
  const frontmatter = Object.create(null);
  let key;
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([\w-]+):[ \t]*(.*)$/.exec(line);
    if (entry) {
      key = entry[1];
      frontmatter[key] = entry[2];
    } else if (key) {
      frontmatter[key] += `\n${line}`;
    }
  }
  return { frontmatter, body: text.slice(match[0].length) };
}

// Decode only scalar metadata used by the SQL table. Keep structured values
// in the raw frontmatter map without treating them as text search metadata.
function scalar(raw) {
  if (raw === undefined) return null;
  const text = raw.split("\n").filter(line => !/^#/.test(line)).join("\n").trim();
  if (/^[>|][-+]?\s*\n/.test(text)) {
    const lines = text.split("\n").slice(1).map(line => line.trim());
    return lines.join(text[0] === ">" ? " " : "\n");
  }
  if (!text || text.includes("\n") || /^(?:\[|\{|&|\*|!)/.test(text)) return null;
  if (text.startsWith('"')) {
    const quoted = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/.exec(text);
    try { return quoted ? JSON.parse(quoted[1]) : null; } catch { return null; }
  }
  if (text.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(text);
    return quoted ? quoted[1].replaceAll("''", "'") : null;
  }
  const value = text.replace(/\s+#.*$/, "");
  return /^(?:null|~)$/i.test(value) ? null : value;
}

export async function readCorpus(dir) {
  const root = resolve(dir);
  let info;
  try { info = await stat(root); } catch { throw new Error(`Corpus folder is missing: ${dir}`); }
  if (!info.isDirectory()) throw new Error(`Corpus is not a folder: ${dir}`);
  const records = [];
  async function walk(folder) {
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const bytes = await readFile(path);
        records.push({ path: relative(root, path).split("\\").join("/"), byteLength: bytes.length,
          ...splitFrontmatter(bytes.toString("utf8")) });
      }
    }
  }
  await walk(root);
  if (!records.length) throw new Error(`Corpus folder has no Markdown files: ${dir}`);
  return { count: records.length, bytes: records.reduce((sum, record) => sum + record.byteLength, 0), records };
}

async function diskBytes(folder) {
  let bytes = 0;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) bytes += await diskBytes(path);
    else if (entry.isFile()) bytes += (await stat(path)).size;
  }
  return bytes;
}

export async function run(engine, corpus) {
  const queries = JSON.parse(await readFile(join(directory, "queries.json"), "utf8"));
  if (!Array.isArray(queries) || queries.length !== 20 || queries.some(query => typeof query !== "string" || !query.trim())) {
    throw new Error("queries.json must contain twenty nonblank query strings.");
  }
  const dataRoot = join(directory, "data");
  await mkdir(dataRoot, { recursive: true });
  const dataDir = await mkdtemp(join(dataRoot, `${engine.name}-`));
  const db = await PGlite.create(dataDir);
  let loadMs;
  let indexMs;
  const timings = [];
  try {
    await db.exec(`CREATE TABLE documents (
      path text PRIMARY KEY, type text, title text, description text, tier text,
      status text, stale_after timestamptz, body text
    )`);
    const loadStart = performance.now();
    await db.transaction(async tx => {
      for (const record of corpus.records) {
        const front = record.frontmatter;
        const stale = scalar(front.stale_after);
        const timestamp = stale === null ? NaN : Date.parse(stale);
        await tx.query(`INSERT INTO documents
          (path, type, title, description, tier, status, stale_after, body)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [record.path, scalar(front.type), scalar(front.title), scalar(front.description),
          scalar(front.tier), scalar(front.status), Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString(), record.body]);
      }
    });
    loadMs = performance.now() - loadStart;
    const indexStart = performance.now();
    await engine.prepare(db);
    indexMs = performance.now() - indexStart;
    for (const [index, query] of queries.entries()) {
      if (!(await engine.query(db, query)).length) throw new Error(`Query ${index + 1} returned no hits; choose a public term present in the corpus.`);
    }
    for (let pass = 0; pass < 5; pass++) {
      for (const query of queries) {
        const start = performance.now();
        await engine.query(db, query);
        timings.push(performance.now() - start);
      }
    }
  } finally {
    await db.close();
  }
  timings.sort((a, b) => a - b);
  // Nearest-rank percentiles over all 100 observations; maxRSS is KiB.
  return { engine: engine.name, loadMs, indexMs,
    queryP50Ms: timings[Math.ceil(timings.length * 0.5) - 1],
    queryP95Ms: timings[Math.ceil(timings.length * 0.95) - 1],
    peakResidentBytes: resourceUsage().maxRSS * 1024, databaseBytes: await diskBytes(dataDir) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { corpus: { type: "string" }, engine: { type: "string" } } });
    if (!values.corpus) throw new Error("Usage: node bench.mjs --corpus <folder> [--engine tsvector]");
    if (values.engine && values.engine !== tsvector.name) throw new Error(`Unknown engine: ${values.engine}`);
    const corpus = await readCorpus(values.corpus);
    console.log(`Corpus: ${corpus.count} Markdown files, ${corpus.bytes} bytes`);
    const result = await run(tsvector, corpus);
    console.log("| Engine | Load ms | Index ms | Query p50 ms | Query p95 ms | Peak resident bytes | Database bytes |");
    console.log("|---|---:|---:|---:|---:|---:|---:|");
    console.log(`| ${result.engine} | ${result.loadMs.toFixed(3)} | ${result.indexMs.toFixed(3)} | ${result.queryP50Ms.toFixed(3)} | ${result.queryP95Ms.toFixed(3)} | ${result.peakResidentBytes} | ${result.databaseBytes} |`);
  } catch (error) {
    console.error(String(error.message).replace(/[\r\n]+/g, " "));
    process.exitCode = 1;
  }
}
