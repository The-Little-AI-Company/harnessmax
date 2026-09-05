import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkAssets } from "./check-assets.mjs";

const fonts = ["Archivo-Variable.woff2", "AtkinsonHyperlegibleNext-Variable.woff2", "AtkinsonHyperlegibleMono-Variable.woff2"];
const stylesheet = "src/styles/tokens/fonts.css";
const icons = "src/app/icons/icons.ts";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "harnessmax-assets-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const css = fonts.map((name) => {
    const bytes = Buffer.from(`fixture font ${name}`);
    put(`src/assets/fonts/${name}`, bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    return `/* @font-source ${name} | https://example.test/${name} | 2026-09-05 | ${hash} */\n@font-face { src: url("../../assets/fonts/${name}"); }`;
  }).join("\n");
  put(stylesheet, css);
  put("src/assets/fonts/OFL.txt", "Fixture license");
  put(icons, 'export const icons = { box: `<path fill="none" stroke="currentColor" d="M0 0h1"/>` };');
  put("src/assets/identity/mark.svg", '<svg><path fill="#f0a000"/></svg>');
  return { root, put, css };
}

function single(root, rule) {
  const findings = checkAssets(root);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].rule, rule);
  for (const key of ["path", "message", "fix"]) assert.ok(findings[0][key]);
  return findings[0];
}

test("complete local assets pass all four rules", (t) => {
  assert.deepEqual(checkAssets(fixture(t).root), []);
});

test("network-asset reports one remote URL", (t) => {
  const { root, put, css } = fixture(t);
  put(stylesheet, `${css}\n@import url("https://example.test/fonts.css");`);
  single(root, "network-asset");
});

test("missing-asset reports one absent required file", (t) => {
  const { root } = fixture(t);
  rmSync(join(root, "src/assets/fonts/OFL.txt"));
  single(root, "missing-asset");
});

test("unproven-font reports one font with no comment record", (t) => {
  const { root, put, css } = fixture(t);
  put(stylesheet, css.replace(/\/\*.*?\*\//, ""));
  single(root, "unproven-font");
});

test("icon-color reports one fixed icon color", (t) => {
  const { root, put } = fixture(t);
  put(icons, 'export const icons = { box: `<path stroke="red"/>` };');
  single(root, "icon-color");
});

test("findings sort by path then rule consistently", (t) => {
  const { root, put } = fixture(t);
  put(icons, '<path stroke="red" style="filter:url(https://example.test/filter)"/>');
  rmSync(join(root, "src/assets/fonts/OFL.txt"));
  const first = checkAssets(root);
  assert.equal(first.length, 3);
  assert.deepEqual(first, checkAssets(root));
  assert.deepEqual(first.map(({ path, rule }) => `${path}:${rule}`), [
    `${icons}:icon-color`, `${icons}:network-asset`, "src/assets/fonts/OFL.txt:missing-asset",
  ]);
});

test("an absent asset folder reports its files without duplicates", (t) => {
  const { root, put } = fixture(t);
  put(stylesheet, "");
  rmSync(join(root, "src/assets/fonts"), { recursive: true });
  const findings = checkAssets(root);
  assert.equal(findings.length, 4);
  assert.ok(findings.every((finding) => finding.rule === "missing-asset"));
});

test("a required path that cannot be read as a file is a finding", (t) => {
  const { root } = fixture(t);
  const path = join(root, "src/assets/fonts/OFL.txt");
  rmSync(path);
  mkdirSync(path);
  single(root, "missing-asset");
});

test("an unreadable stylesheet is a finding", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const { root, put } = fixture(t);
  put("src/styles/locked.css", "body{}");
  const path = join(root, "src/styles/locked.css");
  chmodSync(path, 0);
  try {
    single(root, "missing-asset");
  } finally {
    chmodSync(path, 0o600);
  }
});

test("commented template URLs are ignored", (t) => {
  const { root, put, css } = fixture(t);
  put(stylesheet, `${css}\n/* url(https://example.test/unused) url(missing.woff2) */`);
  assert.deepEqual(checkAssets(root), []);
});

test("scheme, protocol-relative and CSS-escaped URLs are rejected", (t) => {
  const { root, put, css } = fixture(t);
  for (const url of ["//example.test/a", "data:image/svg+xml,test", "file:///tmp/a", String.raw`\68 ttps://example.test/a`]) {
    put(stylesheet, `${css}\nbody{background:URL("${url}")}`);
    single(root, "network-asset");
  }
});

test("URL targets resolve relative to the stylesheet with query and fragment removed", (t) => {
  const { root, put, css } = fixture(t);
  put("src/assets/test (1).svg", '<svg id="shape"/>');
  put(stylesheet, `${css}\nbody{background:url("../../assets/test%20(1).svg?v=1#shape");filter:url(#shape)}`);
  assert.deepEqual(checkAssets(root), []);
  put(stylesheet, `${css}\nbody{background:url(../assets/missing.svg)}`);
  single(root, "missing-asset");
});

test("a changed font digest is rejected", (t) => {
  const { root, put } = fixture(t);
  put(`src/assets/fonts/${fonts[0]}`, "changed font");
  single(root, "unproven-font");
});

test("provenance outside stylesheet comments cannot prove a font", (t) => {
  const { root, put, css } = fixture(t);
  put(stylesheet, css.replace(/\/\* (.*?) \*\//, "$1"));
  single(root, "unproven-font");
});

test("hex, functional, named and serialized icon colors are rejected", (t) => {
  const { root, put } = fixture(t);
  for (const markup of ['<path fill="#fff"/>', '<path style="stroke:rgb(1, 2, 3)"/>', '<path color="rebeccapurple"/>', String.raw`<path stroke=\"red\"/>`, '<path stroke="\nred\n"/>']) {
    put(icons, `export const icons = { box: \`${markup}\` };`);
    single(root, "icon-color");
  }
});

test("vendored SVG URLs are checked and mark colors are exempt", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/identity/mark.svg", '<svg fill="#fff" style="filter:url(https://example.test/filter)"/>');
  single(root, "network-asset");
});

test("escaped URL function names and nested functions are checked", (t) => {
  const { root, put, css } = fixture(t);
  for (const value of [String.raw`\75rl(https://example.test/a)`, "image-set(url(https://example.test/a) 1x)"]) {
    put(stylesheet, `${css}\nbody{background:${value}}`);
    single(root, "network-asset");
  }
});

test("quoted SVG URL targets retain parentheses", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/filter (1).svg", "<svg/>");
  put("src/assets/identity/mark.svg", '<svg style=\'filter:url("../filter (1).svg")\'/>');
  assert.deepEqual(checkAssets(root), []);
});

test("CSS string content is not an asset request", (t) => {
  const { root, put, css } = fixture(t);
  put(stylesheet, `${css}\nbody::after{content:"url(https://example.test/a) /* example */"}`);
  assert.deepEqual(checkAssets(root), []);
});

test("font provenance must be in the font stylesheet", (t) => {
  const { root, put, css } = fixture(t);
  put("src/styles/unused.css", css.match(/\/\*.*?\*\//)[0]);
  put(stylesheet, css.replace(/\/\*.*?\*\//, ""));
  single(root, "unproven-font");
});

test("quoted CSS imports cannot load from a network", (t) => {
  const { root, put, css } = fixture(t);
  put(stylesheet, `${css}\n@import "https://example.test/fonts.css";`);
  single(root, "network-asset");
});

test("SVG link attributes cannot load from a network", (t) => {
  const { root, put } = fixture(t);
  for (const markup of ['<image href="https://example.test/icon.svg"/>', '<use xlink:href="//example.test/sprite.svg#x"/>', '<image href="\nhttps://example.test/icon.svg\n"/>']) {
    put(icons, `export const icons = { box: \`${markup}\` };`);
    single(root, "network-asset");
  }
});

test("inactive SVG markup does not report icon colors or URLs", (t) => {
  const { root, put } = fixture(t);
  put(icons, 'export const icons = { box: `<svg><!-- <path stroke="red" style="filter:url(https://example.test/a)"/> --><path stroke="currentColor"/></svg>` };');
  assert.deepEqual(checkAssets(root), []);
});
