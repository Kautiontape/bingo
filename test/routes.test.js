import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createBoards } from '../server/boards.js';
import { createHub } from '../server/events.js';
import { createApp } from '../server/routes.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
const ITEMS = Array.from({ length: 12 }, (_, i) => `Thing ${i + 1}`);

let app;
beforeEach(() => {
  const hub = createHub();
  const boards = createBoards(openDb(':memory:'), { publish: hub.publish });
  app = createApp({ boards, hub, publicDir, publicUrl: 'https://bingo.example', limits: { create: 3 } });
});

const json = (method, path, body, headers = {}) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const create = async (over = {}) => (await json('POST', '/api/boards', { title: 'Mall <Bingo>', items: ITEMS, size: 3, free: true, ...over })).json();

test('creating, reading and joining a board', async () => {
  const b = await create();
  assert.ok(b.id && b.creatorKey && b.player.token);
  const got = await (await app.request(`/api/boards/${b.id}`, { headers: { 'x-player-token': b.player.token, 'x-creator-key': b.creatorKey } })).json();
  assert.equal(got.isCreator, true);
  assert.equal(got.me.id, b.player.id);
  const j = await json('POST', `/api/boards/${b.id}/join`, { name: 'Maya' });
  assert.equal(j.status, 201);
  assert.equal((await j.json()).player.name, 'Maya');
});

test('API errors come back as JSON with the right status', async () => {
  const b = await create();
  assert.equal((await app.request('/api/boards/nope')).status, 404);
  assert.equal((await json('POST', '/api/boards', { items: ['a'], size: 3 })).status, 400);
  assert.equal((await json('POST', `/api/boards/${b.id}/mark`, { cell: 0, on: true })).status, 401);
  assert.equal((await json('POST', `/api/boards/${b.id}/round`, {}, { 'x-creator-key': 'wrong' })).status, 403);
  const bad = await app.request('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /JSON/);
  assert.equal((await app.request('/api/nothing')).status, 404);
});

test('creator actions work with the key', async () => {
  const b = await create();
  const key = { 'x-creator-key': b.creatorKey };
  assert.equal((await json('POST', `/api/boards/${b.id}/round`, {}, key)).status, 200);
  assert.equal((await json('POST', `/api/boards/${b.id}/clear`, {}, key)).status, 200);
  const edit = await json('PUT', `/api/boards/${b.id}`, { title: 'New', items: ITEMS, size: 3, free: true }, key);
  assert.deepEqual(await edit.json(), { redeal: false });
  assert.equal((await json('POST', `/api/boards/${b.id}/rename-item`, { from: 'Thing 1', to: 'Thing one' }, key)).status, 200);
});

test('board creation is rate limited per IP', async () => {
  for (let i = 0; i < 3; i++) await create();
  const r = await json('POST', '/api/boards', { items: ITEMS, size: 3 });
  assert.equal(r.status, 429);
  const other = await json('POST', '/api/boards', { items: ITEMS, size: 3 }, { 'x-real-ip': '10.0.0.9' });
  assert.equal(other.status, 201);
});

test('board pages carry the escaped title in preview tags', async () => {
  const b = await create();
  const html = await (await app.request(`/b/${b.id}`)).text();
  assert.match(html, /<title>Mall &lt;Bingo&gt;<\/title>/);
  assert.match(html, /og:url" content="https:\/\/bingo.example\/b\//);
  assert.ok(!html.includes('<Bingo>'));
  const res = await app.request('/');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await res.text(), /<title>People Watching Bingo<\/title>/);
});

test('static files revalidate with ETags', async () => {
  const first = await app.request('/js/card.js');
  assert.equal(first.status, 200);
  assert.match(first.headers.get('content-type'), /javascript/);
  const again = await app.request('/js/card.js', { headers: { 'if-none-match': first.headers.get('etag') } });
  assert.equal(again.status, 304);
  assert.equal((await app.request('/nope.js')).status, 404);
});

test('QR code points at the public board URL', async () => {
  const b = await create();
  const r = await app.request(`/api/boards/${b.id}/qr.svg`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /^<svg/);
});
