#!/usr/bin/env node
// Source check only: src/styles/**/*.css, src/assets/**, src/app/icons/**.
// Font provenance belongs in src/styles/tokens/fonts.css comments, one per basename:
// @font-source filename.woff2 | https://source/address | YYYY-MM-DD | <64 hex SHA-256>
// URLs in inactive comments are ignored. Icon colors are checked only in
// src/app/icons/icons.ts; the identity mark intentionally owns its colors.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const sourceExtension = /\.(?:css|svg|[cm]?js|[jt]sx?|html|xml)$/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const cssStrings = String.raw`"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n\f])*(?:"|(?=[\r\n\f]|$))|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n\f])*(?:'|(?=[\r\n\f]|$))`;
const regexLiteral = String.raw`/(?![/*])(?:\\[^\r\n]|\[(?:\\[^\r\n]|[^\]\\\r\n])*\]|[^/\[\\\r\n])+/[a-z]*`;
const regexContext = /(?:[({[=,:;!?&|+*%^~<>-]|\b(?:return|throw|case|delete|void|typeof|yield|await|else|do|in|of|instanceof))\s*$/;

function controlContext() {
  const parentheses = [];
  const braces = [];
  let pending = "";
  return {
    closed: false,
    consume(token, prefix) {
      if (!token.trim()) return;
      const wasClosed = this.closed;
      this.closed = (token === ")" && parentheses.pop() === true) || (token === "}" && braces.pop() === true);
      if (token === "(") parentheses.push(Boolean(pending));
      if (token === "{") braces.push(wasClosed || (braces.at(-1) === true && /\{\s*$/.test(prefix)) || /(?:^|[;})]|=>|\b(?:else|do|try|finally))\s*$/.test(prefix));
      pending = token === "await" && pending === "for" ? pending
        : /^(?:if|while|for|with|switch|catch)$/.test(token) && !/\.\s*$/.test(prefix) ? token : "";
    },
  };
}

function decodeCss(text) {
  return text.replace(/\\(?:([\da-f]{1,6})\s?|([\s\S]))/gi, (_, hex, char) => {
    const point = hex && Number.parseInt(hex, 16);
    return hex ? String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd) : char;
  });
}

// A template's literal text is markup, but its interpolations are JavaScript.
// Keep strings and nested templates intact while removing expression comments.
function templateLiteral(text, start, expression = false) {
  let result = expression ? "{" : "`", index = start + 1, braces = expression ? 1 : 0;
  let context = controlContext();
  while (index < text.length) {
    const char = text[index];
    const previous = result;
    if (char === "\\") {
      result += text.slice(index, index + 2);
      index += 2;
    } else if (!braces && char === "`") {
      return { text: result + char, end: index + 1 };
    } else if (!braces && text.startsWith("${", index)) {
      // Source text cannot contain NUL. Keep this boundary through decoding
      // so unresolved targets differ from literal, escaped ${...} text.
      result += "\0${";
      index += 2;
      braces = 1;
      context = controlContext();
    } else if (braces && text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 2;
      result += " ";
    } else if (braces && text.startsWith("//", index)) {
      const end = text.slice(index).search(/[\r\n]/);
      index = end < 0 ? text.length : index + end;
      result += " ";
    } else if (braces && char === "/" && (regexContext.test(result) || context.closed)) {
      const literal = text.slice(index).match(new RegExp("^" + regexLiteral, "i"))?.[0] ?? char;
      result += literal;
      index += literal.length;
    } else if (braces && char === "`") {
      const nested = templateLiteral(text, index);
      result += nested.text;
      index = nested.end;
    } else if (braces && (char === '"' || char === "'")) {
      const quote = char;
      result += text[index++];
      while (index < text.length) {
        const next = text[index++];
        result += next;
        if (next === "\\" && index < text.length) result += text[index++];
        else if (next === quote) break;
      }
    } else if (braces && /[a-z_$]/i.test(char)) {
      const identifier = text.slice(index).match(/^[\w$]+/)[0];
      result += identifier;
      index += identifier.length;
    } else {
      if (braces && char === "{") braces++;
      if (braces && char === "}") braces--;
      result += char;
      index++;
    }
    if (braces) context.consume(result.slice(previous.length), previous);
    if (expression && !braces) return { text: result, end: index };
  }
  return { text: result, end: index };
}

function readTag(text, start, jsx) {
  if (!/^<(?:\/?[a-z]|\?xml-stylesheet|\/?>)/i.test(text.slice(start))) return null;
  let source = "<", index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'") {
      const end = text.indexOf(char, index + 1);
      const next = end < 0 ? text.length : end + 1;
      source += text.slice(index, next);
      index = next;
    } else if (jsx && char === "{") {
      const region = templateLiteral(text, index, true);
      const value = region.text.slice(1, -1).trim();
      source += /^(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`[^`$]*`)$/.test(value) ? region.text : "{}";
      index = region.end;
    } else {
      source += char;
      index++;
      if (char === ">") return { source, end: index };
    }
  }
  return { source, end: index };
}

function* markupElements(text, html, jsx) {
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start < 0) return;
    if (text.startsWith("<!--", start)) {
      const end = /--!?>/g;
      end.lastIndex = start + 4;
      cursor = end.exec(text) ? end.lastIndex : text.length;
      continue;
    }
    if (text.startsWith("<![CDATA[", start)) {
      const end = text.indexOf("]]>", start + 9);
      cursor = end < 0 ? text.length : end + 3;
      continue;
    }
    const tag = readTag(text, start, jsx);
    if (!tag) { cursor = start + 1; continue; }
    cursor = tag.end;
    const element = tag.source.match(/^<([\w:-]+)/)?.[1]?.toLowerCase();
    const selfClosing = /\/>$/.test(tag.source) && !html;
    if (!selfClosing && (element === "style" || (html && /^(?:textarea|title|xmp|iframe|noembed|noframes|script|plaintext)$/.test(element ?? "")))) {
      const closing = new RegExp(html ? `</${element}(?=[\\s/>])` : `</${element}\\s*>`, "gi");
      closing.lastIndex = cursor;
      const end = element === "plaintext" ? null : closing.exec(text);
      const content = text.slice(cursor, end?.index ?? text.length);
      cursor = end ? (html ? readTag(text, end.index, false).end : closing.lastIndex) : text.length;
      yield { source: tag.source, css: element === "style" ? content : undefined, complete: true };
    } else yield { source: tag.source, complete: false };
  }
}

function decodeJavascript(text) {
  return text.replace(/\\(?:u\{([\da-fA-F]+)\}|u([\da-fA-F]{4})|x([\da-fA-F]{2})|(\r\n|[\s\S]))/g, (_, point, unicode, hex, char) => {
    if (point || unicode || hex) {
      const value = Number.parseInt(point ?? unicode ?? hex, 16);
      return String.fromCodePoint(value > 0 && value <= 0x10ffff ? value : 0xfffd);
    }
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\ufffd", "\n": "", "\r": "", "\r\n": "" })[char] ?? char;
  });
}

// Consume quoted strings as units, so comment markers inside strings survive.
function splitComments(text, javascript = false, jsx = false, extractDocuments = false) {
  const comments = [];
  const documents = [];
  let documentTail = 0;
  const strings = javascript ? String.raw`"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\x60|//[^\r\n]*|[a-z_$][\w$]*|[(){}/]` : cssStrings;
  const tags = jsx ? String.raw`</?[a-z][\w:.-]*|</?>|[{}]|` : "";
  const tokens = new RegExp(tags + String.raw`/\*[\s\S]*?(?:\*/|$)|` + strings, "gi");
  let active = "", cursor = 0, depth = 0;
  const expressions = [];
  const context = controlContext();
  let match;
  while ((match = tokens.exec(text))) {
    const gap = text.slice(cursor, match.index);
    active += gap;
    if (javascript) context.consume(gap, active.slice(0, -gap.length));
    let token = match[0];
    const expression = expressions.at(-1);
    const markupText = depth > 0 && (!expression || depth > expression.depth);
    if (jsx && token.startsWith("<")) {
      const tag = readTag(text, match.index, true);
      token = tag.source;
      tokens.lastIndex = tag.end;
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
    } else if (javascript && token === "`") {
      const literal = templateLiteral(text, match.index);
      token = literal.text;
      tokens.lastIndex = literal.end;
    } else if (javascript && token === "/" && (regexContext.test(active) || context.closed || !active.trim())) {
      const literal = text.slice(match.index).match(new RegExp("^" + regexLiteral, "i"))?.[0];
      if (literal) {
        token = literal;
        tokens.lastIndex = match.index + literal.length;
      }
    } else if (javascript && token.startsWith("//")) {
      token = " ";
    } else if (token.startsWith("/*")) {
      comments.push(token.slice(2).replace(/\*\/$/, ""));
      token = " ";
    }
    if (javascript && !markupText) context.consume(token, active);
    if (extractDocuments && !markupText && /^["'`]/.test(token)) {
      const value = token.startsWith("`") && /\bString\.raw\s*$/.test(active) ? token.slice(1, -1) : decodeJavascript(token.slice(1, -1));
      if (documents.length && /^\s*\+\s*$/.test(active.slice(documentTail))) documents[documents.length - 1] += value;
      else documents.push(value);
      token = '""';
      documentTail = active.length + token.length;
    }
    active += token;
    cursor = tokens.lastIndex;
  }
  return { active: active + text.slice(cursor), comments, documents };
}

function urls(text, stylesheet) {
  text = text.replace(/\r\n?|\f/g, "\n");
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

function srcsetUrls(value) {
  const sources = [];
  let remaining = value;
  while (remaining) {
    remaining = remaining.replace(/^[\s,]+/, "");
    const source = remaining.match(/^\S+/)?.[0];
    if (!source) break;
    sources.push(source.replace(/,+$/, ""));
    remaining = remaining.slice(source.length);
    if (!source.endsWith(",")) remaining = remaining.replace(/^[^,]*(?:,|$)/, "");
  }
  return sources;
}

function inspectMarkup(text, file, inheritedBase, html = /\.html?$/i.test(file) || (!/\.(?:svg|xml)$/i.test(file) && !/^\s*<svg\b/i.test(text))) {
  const references = [];
  const unresolved = [];
  const colors = [];
  const fillRules = [];
  const paintNodes = [];
  let documentBase = inheritedBase, baseSeen = false;
  function reference(value, base, ambiguous = false) {
    if (value.includes("\0")) return;
    if (ambiguous) {
      unresolved.push(value);
      return;
    }
    if (!base || !value || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(value)) {
      references.push(value);
      return;
    }
    try {
      const target = new URL(value, base);
      if (value.startsWith("#") && target.protocol === "file:" && fileURLToPath(target) === file) return;
      if (target.protocol !== "file:") target.hash = "";
      references.push(target.protocol === "file:" ? relative(dirname(file), fileURLToPath(target)).split(sep).map(encodeURIComponent).join("/") : target.href);
    } catch {
      references.push(value);
    }
  }
  const paint = /^(?:fill|stroke|color|stop-color|flood-color|lighting-color)$/i;
  function stylesheet(text, base, embedded = false) {
    const { active } = splitComments(text.replace(/\r\n?|\f/g, "\n"));
    if (embedded) {
      let depth = 0, start = 0, body = 0, selectors = "";
      for (const token of active.matchAll(new RegExp(cssStrings + "|[{}]", "g"))) {
        if (token[0] === "{") {
          if (depth++ === 0) { selectors = active.slice(start, token.index).trim(); body = token.index + 1; }
        } else if (token[0] === "}" && --depth === 0) {
          const declarations = active.slice(body, token.index);
          start = token.index + 1;
          if (selectors.startsWith("@") || /[{}]/.test(declarations.replace(new RegExp(cssStrings, "g"), ""))) continue;
          const fill = stylesheet(declarations, base).get("fill");
          if (!fill) continue;
          for (const selector of selectors.split(",").map((value) => value.trim())) {
            if (/^(?:\*|[a-z][\w-]*|[.#][\w-]+)$/i.test(selector)) fillRules.push({ selector, fill });
          }
        }
      }
    }
    for (const value of urls(active, true)) reference(value, base);
    const declarations = /(?:^|[;{])\s*((?:[-\w]|\\(?:[\da-f]{1,6}\s?|[^\r\n]))+)\s*:\s*([^;}]+)/gi;
    const withoutStrings = active.replace(new RegExp(cssStrings, "g"), '""');
    const paints = new Map();
    for (const match of withoutStrings.matchAll(declarations)) {
      const name = decodeCss(match[1]).toLowerCase();
      if (paint.test(name)) {
        const value = decodeCss(match[2]);
        if (value.includes("\0")) continue;
        colors.push(value);
        paints.set(name, value.trim().replace(/\s*!important$/i, ""));
      }
    }
    return paints;
  }
  const scopes = [{ namespaces: new Map([["xlink", "http://www.w3.org/1999/xlink"]]) }];
  for (const { source, css, complete } of markupElements(text, html, /\.[jt]sx$/i.test(file))) {
    const element = source.match(/^<\/?([\w:-]+)/)?.[1];
    if (source.startsWith("</")) {
      const index = scopes.findLastIndex((scope) => scope.element === element);
      if (index > 0) scopes.length = index;
      continue;
    }
    const namespaces = new Map(scopes.at(-1).namespaces);
    const attributes = new Map();
    const ambiguous = new Set();
    const object = /^<object\b/i.test(source);
    const tag = source.replace(/\b([\w:-]+)\s*=\s*(\{(?:"[^"]*"|'[^']*'|`[^`]*`|[^}])*\}|"[^"]*"|'[^']*'|[^\s"'=<>`{]+)/g, (attribute, name, raw) => {
      if ([...attributes.keys()].some((key) => key.toLowerCase() === name.toLowerCase())) return "";
      const literal = raw.startsWith("{") ? raw.slice(1, -1).trim() : raw;
      if (raw.startsWith("{") && !/^(?:"[^"]*"|'[^']*'|`[^`$]*`)$/.test(literal)) return "";
      let value = (/^["'`]/.test(literal) ? literal.slice(1, -1) : literal).trim();
      if (raw.startsWith("{")) value = decodeJavascript(value);
      // JSX expression strings contain JavaScript text, not XML entities.
      const entities = html ? /&(#x[\da-f]+|#\d+);?|&([a-z][\da-z]*);/gi : /&(#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi;
      if (!raw.startsWith("{")) value = value.replace(entities, (entity, numeric, named) => {
        const entityName = numeric ?? named;
        if (!entityName.startsWith("#")) {
          const decoded = ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entityName];
          if (decoded === undefined) ambiguous.add(name);
          return decoded ?? entity;
        }
        const point = /^#x/i.test(entityName) ? Number.parseInt(entityName.slice(2), 16) : Number(entityName.slice(1));
        return String.fromCodePoint(point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? point : 0xfffd);
      }).trim();
      attributes.set(name, value);
      if (name.startsWith("xmlns:")) namespaces.set(name.slice(6), value);
      return name.toLowerCase() === "style" ? "" : attribute;
    });
    const htmlAttributes = new Map([...attributes].map(([name, value]) => [name.toLowerCase(), value]));
    let scopedBase = scopes.at(-1).base;
    let base = scopedBase ?? documentBase;
    if (html && element?.toLowerCase() === "base" && !baseSeen && htmlAttributes.has("href")) {
      baseSeen = true;
      const value = htmlAttributes.get("href");
      if (!value.includes("\0")) {
        const unknown = [...ambiguous].some((name) => name.toLowerCase() === "href");
        if (unknown || /^(?:[a-z][a-z\d+.-]*:|[/\\]{2})/i.test(value)) reference(value, undefined, unknown);
        try { documentBase = new URL(value.replace(/\\/g, "/"), inheritedBase ?? pathToFileURL(file)); } catch { /* Invalid HTML bases retain the document URL. */ }
      }
    }
    if (attributes.has("xml:base") && !attributes.get("xml:base").includes("\0")) {
      try { base = scopedBase = new URL(attributes.get("xml:base"), base ?? pathToFileURL(file)); } catch { /* An invalid base has no resolvable target. */ }
    }
    if (css !== undefined) stylesheet(css.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"), base, true);
    let inlineFill;
    for (const [name, value] of attributes) {
      if (value.includes("\0")) continue;
      if (html && element?.toLowerCase() === "base" && name.toLowerCase() === "href") continue;
      const [prefix, local] = name.split(":");
      if (/^(?:href|src|poster)$/i.test(name) || (name === "xlinkHref" && /\.[jt]sx$/i.test(file)) || (local === "href" && namespaces.get(prefix) === "http://www.w3.org/1999/xlink") || (object && name.toLowerCase() === "data")) reference(value, base, ambiguous.has(name));
      if (/^srcset$/i.test(name)) for (const source of srcsetUrls(value)) reference(source, base, ambiguous.has(name));
      if (name === "xml:base" && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) references.push(value);
      if (name.toLowerCase() === "srcdoc") {
        const nested = inspectMarkup(value, file, base, true);
        references.push(...nested.references);
        unresolved.push(...nested.unresolved);
        if (nested.color) colors.push(nested.color);
      }
      if (paint.test(name)) colors.push(value);
      if (name.toLowerCase() === "style") inlineFill = stylesheet(value, base).get("fill");
    }
    const paintNode = { element, attributes, inlineFill, parent: scopes.at(-1).paintNode };
    paintNodes.push(paintNode);
    if (element?.toLowerCase() === "meta" && htmlAttributes.get("http-equiv")?.toLowerCase() === "refresh") {
      const refresh = htmlAttributes.get("content")?.match(/;\s*(?:url\s*=\s*)?["']?([^"']+)/i);
      if (refresh) reference(refresh[1].trim(), base);
    }
    if (!complete && !/\/>$/.test(source) && !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(element ?? "") && element) scopes.push({ element, namespaces, base: scopedBase, paintNode });
    for (const value of urls(tag, false)) reference(value, base);
  }
  for (const node of paintNodes) {
    let styled, specificity = -1;
    for (const { selector, fill } of fillRules) {
      const score = selector.startsWith("#") ? 100 : selector.startsWith(".") ? 10 : selector === "*" ? 0 : 1;
      const matches = selector === "*" || selector === node.element || (selector.startsWith("#") && node.attributes.get("id") === selector.slice(1)) || (selector.startsWith(".") && node.attributes.get("class")?.split(/\s+/).includes(selector.slice(1)));
      if (matches && score >= specificity) { styled = fill; specificity = score; }
    }
    node.fill = node.inlineFill ?? styled ?? node.attributes.get("fill") ?? node.parent?.fill ?? "black";
    if (node.fill === "inherit") node.fill = node.parent?.fill ?? "black";
    if (/^(?:path|rect|circle|ellipse|polygon|polyline|text|tspan|textPath)$/.test(node.element ?? "") && node.fill === "black") colors.push("black (default fill)");
  }
  return { references, unresolved, color: colors.find((value) => !/^(?:currentColor|none|inherit)\s*(?:!important)?$/i.test(value.trim())) };
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
  const queue = [...scanned].sort(compare);
  for (const file of queue) {
    const bytes = read(file);
    if (!bytes) continue;
    if (fontExtension.test(file)) {
      fonts.push([file, bytes]);
      continue;
    }
    if (!sourceExtension.test(file)) continue;
    let text;
    try {
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      if (text.includes("\0")) throw new Error("Unsupported NUL text");
    } catch {
      add(localPath(file), "missing-asset", "Cannot decode asset text.", "Use valid UTF-8 or BOM-selected UTF-16 text without NUL characters.");
      continue;
    }
    const isStylesheet = extname(file).toLowerCase() === ".css";
    const javascript = /\.(?:[cm]?js|[jt]sx?)$/i.test(file);
    const { active, comments, documents = [] } = isStylesheet || javascript ? splitComments(text, javascript, /\.[jt]sx$/i.test(file), javascript) : { active: text, comments: [] };
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
    const contents = [active, ...documents.filter((document) => document.includes("<"))];
    const inspections = contents.map((content) => isStylesheet ? { references: urls(content, true) } : inspectMarkup(content, file));
    const inspected = {
      references: inspections.flatMap((result) => result.references),
      unresolved: inspections.flatMap((result) => result.unresolved ?? []),
      color: inspections.find((result) => result.color)?.color,
    };
    for (const value of new Set(inspected.unresolved ?? [])) {
      add(localPath(file), "network-asset", `Cannot establish an offline target with unresolved character references: ${value}`, "Use literal URL characters or numeric character references.");
    }
    for (const originalUrl of new Set(inspected.references)) {
      const url = originalUrl.replace(/\\/g, "/");
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
        add(localPath(file), "network-asset", `URL uses a scheme or network address: ${url}`, "Vendor the asset and use a relative local URL.");
      } else if (url && !url.startsWith("#")) {
        try {
          const path = decodeURIComponent(url.split(/[?#]/, 1)[0]);
          const target = resolve(url.startsWith("/") ? base : dirname(file), path.replace(/^\//, ""));
          if (read(target) && !scanned.has(target) && (sourceExtension.test(target) || fontExtension.test(target))) {
            scanned.add(target);
            queue.push(target);
          }
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
