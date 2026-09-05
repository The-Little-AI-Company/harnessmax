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
const cssStrings = String.raw`"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n\f])*(?:"|(?=[\r\n\f]|$))|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n\f])*(?:'|(?=[\r\n\f]|$))`;

function decodeCss(text) {
  return text.replace(/\\(?:([\da-f]{1,6})\s?|([\s\S]))/gi, (_, hex, char) => {
    const point = hex && Number.parseInt(hex, 16);
    return hex ? String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd) : char;
  });
}

// Consume quoted strings as units, so comment markers inside strings survive.
function splitComments(text, javascript = false, jsx = false) {
  const comments = [];
  const strings = javascript ? String.raw`"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\x60(?:\\[\s\S]|[^\x60\\])*\x60|//[^\r\n]*` : cssStrings;
  const tags = jsx ? String.raw`</?[a-z][\w:.-]*(?:"[^"]*"|'[^']*'|[^'">])*>|</?>|[{}]|` : "";
  const tokens = new RegExp(tags + String.raw`/\*[\s\S]*?(?:\*/|$)|` + strings, "gi");
  let active = "", cursor = 0, depth = 0;
  const expressions = [];
  let match;
  while ((match = tokens.exec(text))) {
    active += text.slice(cursor, match.index);
    let token = match[0];
    const expression = expressions.at(-1);
    const markupText = depth > 0 && (!expression || depth > expression.depth);
    if (jsx && token.startsWith("<")) {
      if (token.startsWith("</")) depth = Math.max(0, depth - 1);
      else if (!token.endsWith("/>")) depth++;
    } else if (jsx && token === "{" && depth > 0) {
      if (markupText) expressions.push({ depth, braces: 1 });
      else expression.braces++;
    } else if (jsx && token === "}" && expression) {
      if (--expression.braces === 0) expressions.pop();
    } else if (markupText) {
      // Quotes and JS comment markers are text here. Resume inside the token
      // so tags between those markers still update the JSX nesting depth.
      token = token.slice(0, 1);
      tokens.lastIndex = match.index + 1;
    } else if (javascript && token.startsWith("//")) {
      token = " ";
    } else if (token.startsWith("/*")) {
      comments.push(token.slice(2).replace(/\*\/$/, ""));
      token = " ";
    }
    active += token;
    cursor = tokens.lastIndex;
  }
  return { active: active + text.slice(cursor), comments };
}

function urls(text, stylesheet) {
  const values = [];
  const identifier = String.raw`((?:[-\w]|\\(?:[\da-f]{1,6}\s?|[^\r\n]))+)\(`;
  const strings = "|" + cssStrings;
  const imports = String.raw`|@((?:[-\w]|\\(?:[\da-f]{1,6}\s?|[^\r\n]))+)\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)')`;
  const tokens = new RegExp(identifier + (stylesheet ? imports + strings + "|[()]" : ""), "gi");
  const argument = /\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\[\s\S]|[^)"'])+))\s*\)/y;
  const functions = [];
  let token;
  while ((token = tokens.exec(text))) {
    if (stylesheet && token[2]) {
      if (decodeCss(token[2]).toLowerCase() === "import") values.push(decodeCss(token[3] ?? token[4]));
      continue;
    }
    const name = token[1] && decodeCss(token[1]).toLowerCase();
    if (name !== "url") {
      if (name || token[0] === "(") functions.push(name);
      else if (token[0] === ")") functions.pop();
      else if (/(?:^|-)image-set$/.test(functions.at(-1)) && /^["']/.test(token[0])) {
        values.push(decodeCss(token[0].slice(1, -1)));
      }
      continue;
    }
    argument.lastIndex = tokens.lastIndex;
    const match = argument.exec(text);
    if (!match) continue;
    values.push(decodeCss((match[1] ?? match[2] ?? match[3]).trim()));
    tokens.lastIndex = argument.lastIndex;
  }
  return values;
}

function inspectMarkup(text) {
  const references = [];
  const colors = [];
  const paint = /^(?:fill|stroke|color|stop-color|flood-color|lighting-color)$/i;
  function stylesheet(text) {
    const { active } = splitComments(text);
    references.push(...urls(active, true));
    for (const match of active.matchAll(/\b(?:fill|stroke|color|stop-color|flood-color|lighting-color)\s*:\s*([^;}]+)/gi)) colors.push(match[1]);
  }
  const markup = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, css) => {
    stylesheet(css);
    return "";
  });
  for (const match of markup.matchAll(/<[a-z][\w:-]*(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const tag = match[0].replace(/\b([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g, (attribute, name, double, single, bare) => {
    const value = (double ?? single ?? bare).trim();
    if (/^(?:href|xlink:href|src)$/i.test(name)) references.push(value);
    if (paint.test(name)) colors.push(value);
    if (name.toLowerCase() === "style") stylesheet(value);
    return name.toLowerCase() === "style" ? "" : attribute;
    });
    references.push(...urls(tag, false));
  }
  return { references, color: colors.find((value) => !/^(?:currentColor|none|inherit)\s*(?:!important)?$/i.test(value.trim())) };
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
    if (!/\.(?:css|svg|[cm]?js|[jt]sx?|json|txt|html|xml)$/i.test(file)) continue;
    const text = bytes.toString("utf8");
    const isStylesheet = extname(file).toLowerCase() === ".css";
    const javascript = /\.(?:[cm]?js|[jt]sx?)$/i.test(file);
    const { active, comments } = isStylesheet || javascript ? splitComments(text, javascript, /\.[jt]sx$/i.test(file)) : { active: text, comments: [] };
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
    const content = javascript ? active.replace(/\\(["'])/g, "$1") : active;
    const inspected = isStylesheet ? { references: urls(content, true) } : inspectMarkup(content);
    for (const url of new Set(inspected.references)) {
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
      const color = inspected.color;
      if (color) add(localPath(file), "icon-color", `Icon uses fixed paint: ${color}`, "Use currentColor for icon paint. Use none for unpainted shapes.");
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
