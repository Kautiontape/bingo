// Two-browser check of the shared flow, run locally before shipping sharing changes:
//   npm run e2e            (CHROMIUM=/path/to/chrome to use another browser)
// Starts the server on a spare port with a throwaway database.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const port = 8900 + Math.floor(Math.random() * 90);
const dir = mkdtempSync(join(tmpdir(), 'bingo-e2e-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(port), DATABASE_URL: join(dir, 'e2e.db') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('listening') && resolve()));
const base = `http://localhost:${port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium' });
const step = (s) => console.log(`· ${s}`);

try {
  const phone = { viewport: { width: 400, height: 860 } };
  const host = await (await browser.newContext(phone)).newPage();
  const guest = await (await browser.newContext(phone)).newPage();

  step('default board deals a 5x5 card');
  await host.goto(base);
  await host.waitForSelector('#grid .cell[data-i="24"]');
  assert.equal(await host.locator('#grid .cell').count(), 25);

  step('create a custom 3x3 board; the share popup opens with a link');
  await host.locator('#menuBtn').click();
  await host.getByRole('menuitem', { name: /Create custom board/ }).click();
  await host.fill('#fTitle', 'E2E Bingo');
  await host.fill('#fItems', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine');
  await host.locator('label[for=fS3]').click();
  await host.locator('#fSubmit').click();
  await host.waitForSelector('#shareDlg[open] .qr img');
  const link = await host.locator('#shareBody input').inputValue();
  assert.match(link, /\/b\/[A-Za-z0-9]{10}$/);
  await host.keyboard.press('Escape');

  step('a guest joins with a fun name and gets the joiner menu');
  await guest.goto(link);
  await guest.waitForSelector('.me-chip');
  await host.waitForFunction(() => document.querySelectorAll('#playerList li').length === 2);
  await guest.locator('#menuBtn').click();
  const items = await guest.locator('#menu [role=menuitem]').allTextContents();
  assert.ok(items.some((t) => t.startsWith('Make my own')));
  assert.ok(!items.some((t) => t.startsWith('New round')));
  await guest.keyboard.press('Escape');

  step('the guest gets a bingo; the host sees the toast');
  await guest.locator('.cell[data-i="3"]').click();
  await guest.locator('.cell[data-i="5"]').click();
  await guest.waitForSelector('#cta:not([hidden])');
  await host.waitForFunction(() => document.querySelector('#toasts').textContent.includes('got BINGO'));

  step('the host starts a new round; the guest’s marks clear');
  await host.locator('#menuBtn').click();
  await host.getByRole('menuitem', { name: /New round/ }).click();
  await host.locator('#menu [data-armed]').click();
  await guest.waitForFunction(() => document.querySelectorAll('.cell.on:not(.free)').length === 0);

  step('Make my own copies the list into a private board');
  await guest.locator('#menuBtn').click();
  await guest.getByRole('menuitem', { name: /Make my own/ }).click();
  await guest.waitForURL(`${base}/mine`);
  assert.equal(await guest.locator('#title').textContent(), 'E2E Bingo');

  console.log('e2e passed');
} finally {
  await browser.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
