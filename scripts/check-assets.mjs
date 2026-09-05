#!/usr/bin/env node
// Source check only: src/styles/**/*.css, src/assets/**, src/app/icons/**.
// Font provenance belongs in src/styles/tokens/fonts.css comments, one per basename:
// @font-source filename.woff2 | https://source/address | YYYY-MM-DD | <64 hex SHA-256>
// URLs in inactive comments are ignored. Icon colors are checked only in
// src/app/icons/icons.ts; the identity mark intentionally owns its colors.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const requiredAssets = [
  "src/assets/fonts/Archivo-Variable.woff2",
  "src/assets/fonts/AtkinsonHyperlegibleNext-Variable.woff2",
  "src/assets/fonts/AtkinsonHyperlegibleMono-Variable.woff2",
  "src/assets/fonts/OFL.txt",
  "src/app/icons/icons.ts",
  "src/assets/identity/mark.svg",
];
const rules = ["network-asset", "missing-asset", "unproven-font", "icon-color"];
const fontExtension = /\.(?:woff2?|ttf|otf)$/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function decodeCss(text) {
  return text.replace(/\\(?:([\da-f]{1,6})\s?|([\s\S]))/gi, (_, hex, char) => {
    const point = hex && Number.parseInt(hex, 16);
    return hex ? String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd) : char;
  });
}

// Consume quoted strings as units, so comment markers inside strings survive.
function splitComments(text) {
  const comments = [];
  const active = text.replace(/\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, (token) => {
    if (!token.startsWith("/*")) return token;
    comments.push(token.slice(2).replace(/\*\/$/, ""));
    return " ";
  });
  return { active, comments };
}

function urls(text, stylesheet) {
  const values = [];
  const identifier = String.raw`((?:[-\w]|\\(?:[\da-f]{1,6}\s?|[^\r\n]))+)\(`;
  const strings = String.raw`|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'`;
  const imports = String.raw`|@import\s+(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)')`;
  const tokens = new RegExp(identifier + (stylesheet ? imports + strings : ""), "gi");
  const argument = /\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\[\s\S]|[^)"'])+))\s*\)/y;
  let token;
  while ((token = tokens.exec(text))) {
    if (stylesheet && (token[2] !== undefined || token[3] !== undefined)) {
      values.push(decodeCss(token[2] ?? token[3]));
      continue;
    }
    if (!token[1] || decodeCss(token[1]).toLowerCase() !== "url") continue;
    argument.lastIndex = tokens.lastIndex;
    const match = argument.exec(text);
    if (!match) continue;
    values.push(decodeCss((match[1] ?? match[2] ?? match[3]).trim()));
    tokens.lastIndex = argument.lastIndex;
  }
  return values;
}

function iconColor(text) {
  const markup = text.replace(/\\(["'])/g, "$1");
  const colors = [];
  for (const match of markup.matchAll(/\b(fill|stroke|color|stop-color|flood-color|lighting-color)\s*=\s*(["'])([\s\S]*?)\2/gi)) colors.push(match[3]);
  for (const match of markup.matchAll(/\b(?:fill|stroke|color|stop-color|flood-color|lighting-color)\s*:\s*([^;"'}]+)/gi)) colors.push(match[1]);
  return colors.find((value) => !/^(?:currentColor|none|inherit)\s*(?:!important)?$/i.test(value.trim()));
}

export function checkAssets(root) {
  const findings = [];
  const add = (path, rule, message, fix) => findings.push({ path, rule, message, fix });
  let base;
  try {
    base = realpathSync(root);
  } catch (error) {
    return [{ path: ".", rule: "missing-asset", message: `Cannot open root (${error.code}).`, fix: "Pass a readable repository directory." }];
  }
  const localPath = (file) => relative(base, file).split(sep).join("/");
  const inside = (file) => {
    const path = relative(base, file);
    return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  };
  const files = new Map();
  function read(file) {
    if (files.has(file)) return files.get(file);
    let bytes = null;
    try {
      if (!inside(file) || !inside(realpathSync(file)) || !lstatSync(file).isFile()) {
        throw Object.assign(new Error(), { code: "NOT_LOCAL_FILE" });
      }
      bytes = readFileSync(file);
    } catch (error) {
      add(localPath(file), "missing-asset", `Cannot read asset (${error.code}).`, "Add a readable regular file inside the repository at this path.");
    }
    files.set(file, bytes);
    return bytes;
  }
  const scanned = new Set();
  function walk(path, stylesOnly = false) {
    const folder = resolve(base, path);
    let entries;
    try {
      if (!lstatSync(folder).isDirectory() || !inside(realpathSync(folder))) {
        throw Object.assign(new Error(), { code: "NOT_LOCAL_DIRECTORY" });
      }
      entries = readdirSync(folder, { withFileTypes: true });
    } catch (error) {
      // Required files own absent asset folders, keeping one finding per asset.
      if (error.code !== "ENOENT" || stylesOnly) {
        add(path, "missing-asset", `Cannot scan directory (${error.code}).`, "Restore a readable directory inside the repository.");
      }
      return;
    }
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child, stylesOnly);
      else if (!stylesOnly || extname(entry.name).toLowerCase() === ".css") scanned.add(resolve(base, child));
    }
  }
  for (const path of requiredAssets) read(resolve(base, path));
  walk("src/styles", true);
  walk("src/assets");
  walk("src/app/icons");

  const provenance = new Map();
  const fonts = [];
  for (const file of [...scanned].sort(compare)) {
    const bytes = read(file);
    if (!bytes) continue;
    if (fontExtension.test(file)) {
      fonts.push([file, bytes]);
      continue;
    }
    if (!/\.(?:css|svg|[cm]?js|ts|json|txt|html|xml)$/i.test(file)) continue;
    const text = bytes.toString("utf8");
    const { active, comments } = splitComments(text);
    if (localPath(file) === "src/styles/tokens/fonts.css") {
      for (const comment of comments) {
        for (const line of comment.split(/\r?\n/)) {
          const record = line.trim().replace(/^\*\s?/, "").match(/^@font-source (\S+) \| (https?:\/\/\S+) \| (\d{4}-\d{2}-\d{2}) \| ([\da-f]{64})$/i);
          if (!record) continue;
          const [, name, source, date, hash] = record;
          const parsed = new Date(`${date}T00:00:00Z`);
          if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) continue;
          try {
            if (!new URL(source).hostname) continue;
          } catch {
            continue;
          }
          const records = provenance.get(name) ?? [];
          records.push(hash.toLowerCase());
          provenance.set(name, records);
        }
      }
    }
    // Serialized icon markup is inspected as text, never imported or executed.
    const content = file.endsWith(".ts") ? active.replace(/\\(["'])/g, "$1") : active;
    const isStylesheet = extname(file).toLowerCase() === ".css";
    const urlText = isStylesheet ? content : content.replace(/<!--[\s\S]*?-->/g, "");
    // Markup attributes and TS strings contain CSS URLs, unlike CSS string values.
    const extracted = urls(urlText, isStylesheet);
    if (!isStylesheet) {
      for (const match of urlText.matchAll(/\b(?:href|xlink:href|src)\s*=\s*(["'])([\s\S]*?)\1/gi)) extracted.push(match[2].trim());
    }
    for (const url of extracted) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
        add(localPath(file), "network-asset", `URL uses a scheme or network address: ${url}`, "Vendor the asset and use a relative local URL.");
      } else if (url && !url.startsWith("#")) {
        try {
          const path = decodeURIComponent(url.split(/[?#]/, 1)[0]);
          read(resolve(url.startsWith("/") ? base : dirname(file), path.replace(/^\//, "")));
        } catch {
          add(localPath(file), "missing-asset", `URL has an invalid local path: ${url}`, "Use a valid relative URL to a readable local file.");
        }
      }
    }
    if (localPath(file) === "src/app/icons/icons.ts") {
      const color = iconColor(urlText);
      if (color) add(localPath(file), "icon-color", `Icon uses fixed paint: ${color}`, "Use currentColor for icon paint; none is allowed for unpainted shapes.");
    }
  }
  for (const [file, bytes] of fonts) {
    const records = provenance.get(basename(file)) ?? [];
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (records.length !== 1 || records[0] !== digest) {
      add(localPath(file), "unproven-font", "Font needs one valid provenance record with its matching SHA-256 digest.", "Add an @font-source line in a stylesheet comment using filename | source URL | fetch date | SHA-256.");
    }
  }
  return findings.sort((a, b) => compare(a.path, b.path) || compare(a.rule, b.rule) || compare(a.message, b.message));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = checkAssets(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  for (const rule of rules) {
    if (!findings.some((finding) => finding.rule === rule)) console.log(`pass ${rule}`);
  }
  for (const { path, rule, message, fix } of findings) {
    console.log(`finding ${rule} ${path}: ${message} Fix: ${fix}`.replace(/[\r\n]/g, " "));
  }
  process.exitCode = Math.min(findings.length, 1);
}
