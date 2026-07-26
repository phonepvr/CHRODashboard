#!/usr/bin/env node
// Assembles the single self-contained dashboard artifact from the source parts.
// Zero dependencies. The deployed artifact must open from file:// with no network
// requests, so everything (CSS, JS, font) is inlined here at build time.
//
// Usage:
//   node build/assemble.mjs --out dist/index.html            # system-font fallback
//   node build/assemble.mjs --font build/font.b64 --out dist/index.html
//   node build/assemble.mjs --check-size dist/index.html --max-bytes 2621440

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

if (args.includes('--check-size')) {
  const file = opt('--check-size');
  const max = Number(opt('--max-bytes') || 2_621_440); // 2.5 MB
  const size = statSync(file).size;
  if (size > max) {
    console.error(`FAIL: ${file} is ${size} bytes (> ${max})`);
    process.exit(1);
  }
  console.log(`OK: ${file} is ${(size / 1024).toFixed(1)} KB (limit ${(max / 1024).toFixed(0)} KB)`);
  process.exit(0);
}

const outPath = opt('--out') || 'dist/index.html';
const fontPath = opt('--font');

const read = (p) => readFileSync(join(root, p), 'utf8');

// CSS parts, in cascade order.
const css = ['src/css/tokens.css', 'src/css/app.css', 'src/css/print.css']
  .map((p) => `/* ---- ${p} ---- */\n` + read(p))
  .join('\n');

// JS parts: everything under src/js sorted lexicographically (00-…, 01-…, …, 99-main.js),
// with src/js/tabs/* injected just before 99-main.js.
const jsDir = join(root, 'src/js');
const top = readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
const tabsDir = join(jsDir, 'tabs');
const tabs = existsSync(tabsDir)
  ? readdirSync(tabsDir).filter((f) => f.endsWith('.js')).sort().map((f) => join('tabs', f))
  : [];
const order = [...top.filter((f) => f !== '99-main.js'), ...tabs, ...top.filter((f) => f === '99-main.js')];
const js = '"use strict";\n' + order
  .map((f) => `/* ---- src/js/${f} ---- */\n` + readFileSync(join(jsDir, f), 'utf8'))
  .join('\n');

let html = read('src/index.template.html');

// Font: either inline the base64 woff2 inside the guarded block, or strip the block
// entirely so the CSS system-font stack applies (still fully offline).
const FONT_BLOCK = /<!--@font-start-->[\s\S]*?<!--@font-end-->/;
if (fontPath) {
  const fonts = JSON.parse(readFileSync(fontPath, 'utf8')); // {"400": b64, "600": b64, "700": b64}
  let total = 0;
  html = html.replace(FONT_BLOCK, (block) => {
    block = block.replace('<!--@font-start-->', '').replace('<!--@font-end-->', '');
    for (const [w, b64] of Object.entries(fonts)) {
      block = block.replace(`__FONT_B64_${w}__`, b64);
      total += b64.length;
    }
    return block;
  });
  console.log(`font: embedded ${(total / 1024).toFixed(1)} KB base64 woff2 (${Object.keys(fonts).join('/')})`);
} else {
  html = html.replace(FONT_BLOCK, '<!-- font: system stack fallback (no embedded font in this build) -->');
  console.log('font: none (system stack fallback)');
}

const inject = (marker, payload) => {
  if (!html.includes(marker)) throw new Error(`marker not found: ${marker}`);
  html = html.replace(marker, payload);
};
inject('<!--@inject:css-->', `<style>\n${css}\n</style>`);
inject('<!--@inject:js-->', `<script>\n${js}\n</script>`);

// Refuse to ship an artifact that still contains an unresolved marker.
for (const m of ['<!--@inject:', '__FONT_B64__']) {
  if (html.includes(m)) throw new Error(`unresolved marker in output: ${m}`);
}

mkdirSync(join(root, dirname(outPath)), { recursive: true });
writeFileSync(join(root, outPath), html);
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);
