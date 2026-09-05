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
  for (const keyword of ["@import ", "@import", String.raw`@im\70ort`]) {
    put(stylesheet, `${css}\n${keyword}"https://example.test/fonts.css";`);
    single(root, "network-asset");
    put(stylesheet, `${css}\n${keyword}'missing.css';`);
    single(root, "missing-asset");
  }
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
  put(icons, 'export const icons = { box: `<svg fill="none"><!-- <path stroke="red" style="filter:url(https://example.test/a)"/> --><path stroke="currentColor"/></svg>` };');
  assert.deepEqual(checkAssets(root), []);
});

test("quoted image-set sources are checked without treating type strings as paths", (t) => {
  const { root, put, css } = fixture(t);
  put("src/assets/image.png", "fixture image");
  for (const [source, rule] of [["https://example.test/a.png", "network-asset"], ["missing.png", "missing-asset"], ["../../assets/image.png", null]]) {
    put(stylesheet, `${css}\nbody{background:image-set("${source}" type("image/png") 1x)}`);
    if (rule) single(root, rule);
    else assert.deepEqual(checkAssets(root), []);
  }
});

test("CSS resumes scanning after a bad string's raw newline", (t) => {
  const { root, put, css } = fixture(t);
  for (const newline of ["\n", "\r", "\f"]) {
    put(stylesheet, `${css}\n.bad{content:"x${newline};}.good{background:url(https://example.test/a);content:"y"}`);
    single(root, "network-asset");
  }
});

test("embedded SVG CSS checks quoted imports and image-set sources", (t) => {
  const { root, put } = fixture(t);
  for (const css of ['@import "https://example.test/a.css";', 'svg{background:image-set("https://example.test/a.png" 1x)}']) {
    put("src/assets/identity/mark.svg", `<svg><style>${css}</style></svg>`);
    single(root, "network-asset");
  }
});

test("unquoted markup URL attributes are checked", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/test.html", "<img src=https://example.test/a.png>");
  single(root, "network-asset");
});

test("unquoted icon paint is checked", (t) => {
  const { root, put } = fixture(t);
  put(icons, "export const icons = { box: `<path stroke=red />` };");
  single(root, "icon-color");
});

test("CSS comment delimiters are ordinary markup text", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/identity/mark.svg", '<svg>/*<image href="https://example.test/a.svg"/>*/</svg>');
  single(root, "network-asset");
});

test("JSX and TSX vendored files are scanned", (t) => {
  const { root, put } = fixture(t);
  for (const extension of ["jsx", "tsx"]) {
    const path = `src/app/icons/extra.${extension}`;
    put(path, 'export const icon = <image href="https://example.test/a.svg"/>;');
    single(root, "network-asset");
    rmSync(join(root, path));
  }
});

test("JavaScript comments are inactive while string and template URLs survive", (t) => {
  const { root, put } = fixture(t);
  put(icons, '// const old = \'<path stroke="red" href="https://example.test/a"/>\';\nexport const icons = {};');
  assert.deepEqual(checkAssets(root), []);
  for (const quote of ["'", "`", '"']) {
    const markup = quote === '"' ? '<image href=\\"//example.test/a\\"/>' : '<image href="//example.test/a"/>';
    put(icons, `export const icons = { box: ${quote}${markup}${quote} };`);
    single(root, "network-asset");
  }
});

test("serialized markup is inspected inside a direct JavaScript string assignment", (t) => {
  const { root, put } = fixture(t);
  put(icons, 'export const icon = "<path stroke=\\"red\\"/>";');
  single(root, "icon-color");
});

test("JSX text preserves comment markers while expression comments stay inactive", (t) => {
  const { root, put } = fixture(t);
  const path = "src/app/icons/extra.tsx";
  put(path, 'export const icon = <svg>/*<g><image href="https://example.test/a.svg"/></g>*/</svg>;');
  single(root, "network-asset");
  put(path, 'export const icon = <svg>{/* <image href="https://example.test/a.svg"/> */}</svg>;');
  assert.deepEqual(checkAssets(root), []);
});

test("JavaScript assignments outside markup are not paint or asset attributes", (t) => {
  const { root, put } = fixture(t);
  put(icons, 'const color = "red"; const src = "https://example.test/a"; const example = "url(https://example.test/not-rendered)"; export const icons = { box: `<path fill="none" stroke="currentColor"/>` };');
  assert.deepEqual(checkAssets(root), []);
});

test("JSX static expression attributes resolve local and remote targets", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/local.svg", "<svg/>");
  for (const quote of ['"', "'", "`"]) {
    put("src/app/icons/extra.tsx", `export const icon = <image href={${quote}../../assets/local.svg${quote}}/>;`);
    assert.deepEqual(checkAssets(root), []);
    put("src/app/icons/extra.tsx", `export const icon = <image href={${quote}https://example.test/a.svg${quote}}/>;`);
    single(root, "network-asset");
  }
});

test("srcset candidates are checked individually", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/local.png", "fixture image");
  put("src/assets/test.html", '<img srcset="local.png 1x, missing.png 2x">');
  single(root, "missing-asset");
  put("src/assets/test.html", '<img srcset="https://example.test/a.png 1x, https://example.test/b.png 2x">');
  const findings = checkAssets(root);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(({ rule }) => rule === "network-asset"));
  rmSync(join(root, "src/assets/test.html"));
  put("src/app/icons/extra.tsx", 'export const icon = <img srcSet={"../../assets/local.png 1x"}/>;');
  assert.deepEqual(checkAssets(root), []);
});

test("comments inside template expressions stay inactive, including nested templates", (t) => {
  const { root, put } = fixture(t);
  for (const source of [
    'export const icon = `<svg>${/* <image href="https://example.test/a"/> */ ""}</svg>`;',
    'export const icon = `<svg>${`<g>${/* <image href="https://example.test/a"/> */ ""}</g>`}</svg>`;',
    'export const icon = `<svg>${// <image href="https://example.test/a"/>\n ""}</svg>`;',
  ]) {
    put(icons, source);
    assert.deepEqual(checkAssets(root), []);
  }
});

test("XML stylesheet processing instructions are checked", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/identity/mark.svg", '<?xml-stylesheet href="https://example.test/a.css"?><svg/>');
  single(root, "network-asset");
});

test("poster and object data attributes are asset references", (t) => {
  const { root, put } = fixture(t);
  for (const markup of ['<video poster="https://example.test/a.png"></video>', '<object data="https://example.test/a.svg"></object>']) {
    put("src/assets/test.html", markup);
    single(root, "network-asset");
  }
});

test("regex literal comment markers do not erase active markup", (t) => {
  const { root, put } = fixture(t);
  for (const source of [
    'export const icon = `<svg>${/[/*]/.test("x") ? "" : ""}<image href="https://example.test/a"/></svg>`;',
    'const regex = /[/*]/; export const icon = `<image href="https://example.test/a"/>`;',
  ]) {
    put(icons, source);
    single(root, "network-asset");
  }
});

test("comments in static JSX attributes do not change their values", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/local.svg", "<svg/>");
  put("src/app/icons/extra.tsx", 'export const icon = <image href={/* source */ "../../assets/local.svg" /* end */}/>;');
  assert.deepEqual(checkAssets(root), []);
});

test("markup character references decode before resolving asset paths", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/logo&mark.svg", "<svg/>");
  put("src/assets/identity/mark.svg", '<svg><use href="&#35;shape"/><use href="&#32;&#x23;shape"/><image href="../logo&amp;mark.svg&#32;"/></svg>');
  assert.deepEqual(checkAssets(root), []);
  put("src/assets/identity/mark.svg", '<svg><image href="&#104;ttps://example.test/a"/></svg>');
  single(root, "network-asset");
  put("src/assets/identity/mark.svg", "<svg/>");
  put(icons, 'export const icon = `<path fill="none" stroke="current&#x43;olor"/>`;');
  assert.deepEqual(checkAssets(root), []);
});

test("CSS hex escapes consume CRLF as one newline", (t) => {
  const { root, put, css } = fixture(t);
  put(stylesheet, css + '\nbody{background:\\75\r\nrl(https://example.test/a)}');
  single(root, "network-asset");
});

test("HTML style elements continue through end of file", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/test.html", '<style>@import "https://example.test/a.css";');
  single(root, "network-asset");
});

test("srcdoc documents are decoded and inspected recursively", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/test.html", '<iframe srcdoc="&lt;img src=https://example.test/a&gt;"></iframe>');
  single(root, "network-asset");
});

test("regex literals after control headers preserve later markup", (t) => {
  const { root, put } = fixture(t);
  for (const header of ['if (flag)', 'while (ready())', 'for (const x of xs)', 'for await (const x of xs)', 'if (fn("(") && /[)]/.test(value))']) {
    put(icons, `${header} /[/*]/.test("x"); export const icon = \`<image href="https://example.test/a"/>\`;`);
    single(root, "network-asset");
  }
  put(icons, 'export const icon = `<svg>${(() => { if (flag) /[/*]/.test("x"); return ""; })()}<image href="https://example.test/a"/></svg>`;');
  single(root, "network-asset");
  put(icons, 'const quotient = fn() / divisor; export const icon = `<image href="https://example.test/a"/>`;');
  single(root, "network-asset");
});

test("network XML bases are rejected even for fragment references", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/identity/mark.svg", '<svg xml:base="https://example.test/sprite.svg"><use href="#icon"/></svg>');
  single(root, "network-asset");
});

test("escaped CSS paint property identifiers cannot hide fixed colors", (t) => {
  const { root, put } = fixture(t);
  put(icons, String.raw`export const icon = '<path style="st\72 oke:red"/>';`);
  single(root, "icon-color");
  put(icons, 'export const icon = `<svg><style>.label{content:";stroke:red"}.shape{stroke:currentColor}</style></svg>`;');
  assert.deepEqual(checkAssets(root), []);
});

test("CDATA text is inactive markup but remains active inside SVG styles", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/identity/mark.svg", '<svg><![CDATA[<image href="https://example.test/a"/>]]></svg>');
  assert.deepEqual(checkAssets(root), []);
  put("src/assets/identity/mark.svg", '<svg><style><![CDATA[@import "https://example.test/a.css";]]></style></svg>');
  single(root, "network-asset");
});

test("meta refresh targets are checked regardless of attribute order", (t) => {
  const { root, put } = fixture(t);
  for (const attrs of ['http-equiv="refresh" content="0;url=https://example.test/a"', 'content="0; URL=\'https://example.test/a\'" http-equiv="Refresh"']) {
    put("src/assets/test.html", `<meta ${attrs}>`);
    single(root, "network-asset");
  }
});

test("XLink namespace aliases apply within their declared scope", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/identity/mark.svg", '<svg xmlns:x="http://www.w3.org/1999/xlink"><image x:href="https://example.test/a"/></svg>');
  single(root, "network-asset");
  put("src/assets/identity/mark.svg", '<svg xmlns:x="http://www.w3.org/1999/xlink"><g xmlns:x="urn:other"><image x:href="https://example.test/a"/></g></svg>');
  assert.deepEqual(checkAssets(root), []);
});

test("unresolved JSX expressions are not invented filenames", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/local.svg", "<svg/>");
  put("src/app/icons/extra.tsx", 'const localIcon = "../../assets/local.svg"; export const icon = <image href={localIcon}/>;');
  assert.deepEqual(checkAssets(root), []);
});

test("relative XML bases apply to descendants and restore at closing tags", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/logo#mark.svg", "<svg/>");
  put("src/assets/logo%mark.svg", "<svg/>");
  put("src/assets/identity/mark.svg", '<svg xml:base="../"><image href="logo%23mark.svg"/><image href="logo%25mark.svg"/><image href="fonts/OFL.txt"/><g xml:base="fonts/"><image href="OFL.txt"/><style>svg{filter:url(OFL.txt)}</style></g><image href="fonts/OFL.txt"/></svg>');
  assert.deepEqual(checkAssets(root), []);
});

test("unresolved named entities cannot disguise offline asset targets", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/test.html", '<img src="https&colon;&sol;&sol;example.test/a">');
  single(root, "network-asset");
});

test("duplicate attributes retain their first value", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/local.svg", "<svg/>");
  put("src/assets/test.html", '<img src="https://example.test/a" src="local.svg">');
  single(root, "network-asset");
  rmSync(join(root, "src/assets/test.html"));
  put(icons, 'export const icon = `<path stroke="red" stroke="currentColor"/>`;');
  single(root, "icon-color");
});

test("regex literals after statement boundaries preserve later markup", (t) => {
  const { root, put } = fixture(t);
  for (const statement of ['if (flag) foo(); else /[/*]/.test("x");', 'do /[/*]/.test("x"); while (flag);', 'if (flag) {} /[/*]/.test("x");', 'if (flag) { {} /[/*]/.test("x"); }']) {
    put(icons, `${statement} export const icon = \`<image href="https://example.test/a"/>\`;`);
    single(root, "network-asset");
  }
});

test("HTML alternate comment endings preserve active following markup", (t) => {
  const { root, put } = fixture(t);
  put("src/assets/test.html", '<!-- old --!><img src="https://example.test/a">');
  single(root, "network-asset");
});

test("React xlinkHref properties are asset references", (t) => {
  const { root, put } = fixture(t);
  put("src/app/icons/extra.tsx", 'export const icon = <image xlinkHref="https://example.test/a.svg" />;');
  single(root, "network-asset");
});

test("HTML raw text and RCDATA are not nested asset markup", (t) => {
  const { root, put } = fixture(t);
  for (const element of ["textarea", "title", "xmp", "iframe", "noembed", "noframes", "script"]) {
    put("src/assets/test.html", `<${element}><img src="https://example.test/a"></${element}>`);
    assert.deepEqual(checkAssets(root), []);
  }
});

test("icon geometry cannot inherit the default black fill", (t) => {
  const { root, put } = fixture(t);
  put(icons, 'export const icon = `<svg><path d="M0 0h1"/></svg>`;');
  single(root, "icon-color");
  for (const fill of ["none", "currentColor"]) {
    put(icons, `export const icon = \`<svg fill="${fill}"><path d="M0 0h1"/></svg>\`;`);
    assert.deepEqual(checkAssets(root), []);
  }
  for (const selector of ["path", "*", ".shape", "#shape"]) {
    put(icons, `export const icon = \`<svg><path id="shape" class="shape" stroke="currentColor"/><style>${selector}{fill:none}</style></svg>\`;`);
    assert.deepEqual(checkAssets(root), []);
  }
});
