// Renders public/og.png (link previews) and public/apple-touch-icon.png with headless Chromium.
// Run after changing the look: CHROMIUM=/path/to/chrome node scripts/make-images.js

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const icon = readFileSync(root('public/favicon.svg'), 'utf8');
const fonts =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Unbounded:wght@600;800&display=swap">';

const cells = ['Talking on phone', 'Baby in stroller', 'Picking nose', 'Dog on a leash', null, 'Drinking coffee', 'Socks with sandals', 'Big yawn', 'Sunglasses indoors'];
const on = new Set([0, 4, 8]);

const og = `<!doctype html><meta charset="utf-8">${fonts}
<style>
  body { margin: 0; width: 1200px; height: 630px; display: flex; align-items: center; gap: 64px; padding: 0 80px;
         box-sizing: border-box; background: #F4ECF5; color: #241029; font-family: Archivo, sans-serif; }
  .words { flex: 1; }
  .eyebrow { font: 700 26px Unbounded; color: #D3166F; }
  .eyebrow span { color: #6C5874; font-weight: 600; }
  h1 { font: 800 76px/1.02 Unbounded; margin: 14px 0 22px; letter-spacing: -0.02em; }
  p { font-size: 30px; color: #6C5874; margin: 0; }
  .card { background: #FFFAFD; border: 4px solid #241029; border-radius: 26px; padding: 14px; box-shadow: 12px 12px 0 #D3166F;
          display: grid; grid-template-columns: repeat(3, 132px); gap: 10px; }
  .c { aspect-ratio: 1; border: 2px solid #DCC9E2; border-radius: 16px; display: flex; align-items: center; justify-content: center;
       text-align: center; padding: 8px; font-weight: 700; font-stretch: 80%; font-size: 21px; line-height: 1.1; }
  .c.on { background: #5A1FC4; border-color: #5A1FC4; color: #fff; }
  .c.free { background: #5A1FC4; color: #fff; font: 600 17px Unbounded; border-color: #5A1FC4; }
</style>
<div class="words">
  <div class="eyebrow">bingo<span>.kautiontape.com</span></div>
  <h1>People Watching Bingo</h1>
  <p>Spot it, tap it, shout BINGO. Make a board and play it together.</p>
</div>
<div class="card">${cells.map((c, i) => `<div class="c ${c === null ? 'free' : on.has(i) ? 'on' : ''}">${c ?? 'Free space ★'}</div>`).join('')}</div>`;

const touch = `<!doctype html><style>body{margin:0}svg{display:block;width:180px;height:180px}</style>${icon.replace('rx="14"', 'rx="0"')}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium' });
const page = await browser.newPage();
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(og, { waitUntil: 'networkidle' });
await page.screenshot({ path: root('public/og.png') });
await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(touch);
await page.screenshot({ path: root('public/apple-touch-icon.png') });
await browser.close();
console.log('wrote public/og.png and public/apple-touch-icon.png');
