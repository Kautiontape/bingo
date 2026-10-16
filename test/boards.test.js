import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { BOARD_TTL_MS, MAX_PLAYERS, PLAYER_IDLE_MS, BoardError, createBoards } from '../server/boards.js';
import { setMark, freeIndex } from '../public/js/card.js';

const ITEMS = Array.from({ length: 30 }, (_, i) => `Item ${i + 1}`);
const settings = (over = {}) => ({ title: 'Test', items: ITEMS, size: 3, free: true, mode: 'cards', ...over });

let db, boards, events, clock;
beforeEach(() => {
  db = openDb(':memory:');
  events = [];
  clock = { t: 1_000_000 };
  boards = createBoards(db, {
    publish: (id, event, data) => events.push({ id, event, data: typeof data === 'function' ? data() : data }),
    now: () => clock.t,
  });
});

const rejects = (fn, status) =>
  assert.throws(fn, (e) => e instanceof BoardError && e.status === status, `expected ${status}`);
const named = (event) => events.filter((e) => e.event === event);
const firstReal = (cells) => cells.findIndex((c) => c !== null);

test('create validates settings', () => {
  rejects(() => boards.create(settings({ size: 6 })), 400);
  rejects(() => boards.create(settings({ items: ['a', 'b'] })), 400);
  rejects(() => boards.create(settings({ items: ['x'.repeat(81), ...ITEMS] })), 400);
  rejects(() => boards.create(settings({ mode: 'chaos' })), 400);
  rejects(() => boards.create(settings({ title: 't'.repeat(61) })), 400);
});

test('create joins the creator as the first player', () => {
  const r = boards.create(settings({ name: 'Shawn' }));
  assert.match(r.id, /^[A-Za-z2-9]{10}$/);
  assert.ok(r.creatorKey && r.player.token);
  const g = boards.get(r.id, { token: r.player.token, key: r.creatorKey });
  assert.equal(g.isCreator, true);
  assert.equal(g.me.name, 'Shawn');
  assert.equal(g.me.card.length, 9);
  assert.equal(g.board.players.length, 1);
  assert.equal(boards.get(r.id, { key: 'nope' }).isCreator, false);
});

test('create keeps a valid card and marks sent by the client, and rejects a forged one', () => {
  const card = ['Item 1', 'Item 2', 'Item 3', 'Item 4', null, 'Item 5', 'Item 6', 'Item 7', 'Item 8'];
  const r = boards.create(settings({ card, marks: 0b11 }));
  const me = boards.get(r.id, { token: r.player.token }).me;
  assert.deepEqual(me.card, card);
  assert.equal(me.marks, 0b11);

  const forged = boards.create(settings({ card: ['<b>', ...card.slice(1)] }));
  const card2 = boards.get(forged.id, { token: forged.player.token }).me.card;
  assert.ok(!card2.includes('<b>'));
});

test('a shared board keeps the creator’s card as the shared card, credited to them', () => {
  const card = ['Item 1', 'Item 2', 'Item 3', 'Item 4', null, 'Item 5', 'Item 6', 'Item 7', 'Item 8'];
  const r = boards.create(settings({ mode: 'shared', card, marks: 0b1 }));
  const b = boards.snapshot(r.id);
  assert.deepEqual(b.shared.cells, card);
  assert.equal(b.shared.marks, 1);
  assert.equal(b.shared.by[0], r.player.id);
  assert.equal(b.players[0].marked, 1);
});

test('joining deals a card and picks a fun name and a distinct color', () => {
  const r = boards.create(settings());
  const j = boards.join(r.id);
  assert.match(j.player.name, /^\w+ [\w ]+$/);
  assert.equal(j.me.card.length, 9);
  const snap = boards.snapshot(r.id);
  assert.equal(snap.players.length, 2);
  assert.notEqual(snap.players[0].color, snap.players[1].color);
  assert.equal(named('join').length, 1);
  assert.equal(boards.join(r.id, { name: '  Maya  ' }).player.name, 'Maya');
});

test('marking needs a player token and a real, non-free square', () => {
  const r = boards.create(settings());
  const t = r.player.token;
  rejects(() => boards.mark(r.id, 'bad', 0, true), 401);
  rejects(() => boards.mark(r.id, t, 9, true), 400);
  rejects(() => boards.mark(r.id, t, freeIndex(3, true), true), 400);
  rejects(() => boards.mark(r.id, t, 0, 'yes'), 400);
  rejects(() => boards.mark('nope', t, 0, true), 404);
  assert.equal(boards.mark(r.id, t, 0, true).marks, 1);
  assert.equal(boards.mark(r.id, t, 0, true).marks, 1, 'explicit on is idempotent');
  assert.equal(boards.mark(r.id, t, 0, false).marks, 0);
});

test('completing a line publishes a bingo event and shows in progress', () => {
  const r = boards.create(settings({ name: 'Shawn' }));
  const t = r.player.token;
  // Middle row of a 3x3 with a free center: cells 3 and 5.
  boards.mark(r.id, t, 3, true);
  assert.equal(named('bingo').length, 0);
  boards.mark(r.id, t, 5, true);
  const bingo = named('bingo');
  assert.equal(bingo.length, 1);
  assert.equal(bingo[0].data.name, 'Shawn');
  const p = boards.snapshot(r.id).players[0];
  assert.equal(p.lines, 1);
  assert.equal(p.away, 0);
});

test('shared mode: anyone marks the one card and the completer gets the bingo', () => {
  const r = boards.create(settings({ mode: 'shared' }));
  const maya = boards.join(r.id, { name: 'Maya' });
  boards.mark(r.id, r.player.token, 3, true);
  boards.mark(r.id, maya.player.token, 5, true);
  const s = boards.snapshot(r.id).shared;
  assert.equal(s.by[3], r.player.id);
  assert.equal(s.by[5], maya.player.id);
  assert.equal(named('bingo')[0].data.name, 'Maya');
  // Unmarking clears the credit; re-marking an already-marked square keeps the first marker.
  boards.mark(r.id, maya.player.token, 3, true);
  assert.equal(boards.snapshot(r.id).shared.by[3], r.player.id);
  boards.mark(r.id, maya.player.token, 3, false);
  assert.equal(boards.snapshot(r.id).shared.by[3], null);
});

test('only the creator can start a round, clear, edit or rename an item', () => {
  const r = boards.create(settings());
  const j = boards.join(r.id);
  for (const fn of [
    () => boards.newRound(r.id, j.player.token),
    () => boards.clear(r.id, ''),
    () => boards.edit(r.id, 'x', settings()),
    () => boards.renameItem(r.id, undefined, 'Item 1', 'Thing'),
  ]) rejects(fn, 403);
});

test('new round re-deals every card, clears marks and bumps rev', () => {
  const r = boards.create(settings());
  const j = boards.join(r.id);
  boards.mark(r.id, j.player.token, firstReal(j.me.card), true);
  const before = boards.snapshot(r.id);
  boards.newRound(r.id, r.creatorKey);
  const after = boards.snapshot(r.id);
  assert.equal(after.rev, before.rev + 1);
  assert.ok(after.players.every((p) => p.marks === 0));
  assert.equal(named('round').length, 1);
});

test('clear wipes marks but keeps cards', () => {
  const r = boards.create(settings({ mode: 'shared' }));
  boards.mark(r.id, r.player.token, 0, true);
  const cells = boards.snapshot(r.id).shared.cells;
  boards.clear(r.id, r.creatorKey);
  const s = boards.snapshot(r.id);
  assert.equal(s.shared.marks, 0);
  assert.deepEqual(s.shared.cells, cells);
  assert.ok(s.shared.by.every((x) => x === null));
});

test('edit: title-only keeps the round, list changes re-deal, mode never changes', () => {
  const r = boards.create(settings());
  boards.mark(r.id, r.player.token, 0, true);
  const rev = boards.snapshot(r.id).rev;
  assert.equal(boards.edit(r.id, r.creatorKey, settings({ title: 'Renamed', freeText: 'Gimme' })).redeal, false);
  let s = boards.snapshot(r.id);
  assert.equal(s.title, 'Renamed');
  assert.equal(s.freeText, 'Gimme');
  assert.equal(s.rev, rev);
  assert.equal(s.players[0].marks, 1);

  assert.equal(boards.edit(r.id, r.creatorKey, settings({ size: 4, mode: 'shared' })).redeal, true);
  s = boards.snapshot(r.id);
  assert.equal(s.size, 4);
  assert.equal(s.mode, 'cards');
  assert.equal(s.rev, rev + 1);
  assert.equal(boards.get(r.id, { token: r.player.token }).me.card.length, 16);
});

test('renaming an item updates the list and every card holding it, keeping marks', () => {
  const r = boards.create(settings({ items: ITEMS.slice(0, 8) }));
  const j = boards.join(r.id);
  const target = j.me.card[0];
  boards.mark(r.id, j.player.token, 0, true);
  boards.renameItem(r.id, r.creatorKey, target, 'Fixed typo');
  const me = boards.get(r.id, { token: j.player.token }).me;
  assert.equal(me.card[0], 'Fixed typo');
  assert.equal(me.marks, 1);
  const s = boards.snapshot(r.id);
  assert.ok(s.items.includes('Fixed typo') && !s.items.includes(target));
  rejects(() => boards.renameItem(r.id, r.creatorKey, 'Fixed typo', s.items.find((x) => x !== 'Fixed typo')), 409);
  rejects(() => boards.renameItem(r.id, r.creatorKey, 'Not there', 'x'), 404);
});

test('rename validates names', () => {
  const r = boards.create(settings());
  assert.equal(boards.rename(r.id, r.player.token, ' Lanyard   Guy ').name, 'Lanyard Guy');
  rejects(() => boards.rename(r.id, r.player.token, '   '), 400);
  rejects(() => boards.rename(r.id, r.player.token, 'n'.repeat(31)), 400);
});

test('a full board drops idle players to make room, and refuses when everyone is active', () => {
  const r = boards.create(settings());
  for (let i = 1; i < MAX_PLAYERS; i++) boards.join(r.id);
  rejects(() => boards.join(r.id), 409);
  clock.t += PLAYER_IDLE_MS + 1;
  boards.mark(r.id, r.player.token, 0, true); // the creator stays active
  boards.join(r.id);
  const players = boards.snapshot(r.id).players;
  assert.equal(players.length, 2);
  assert.equal(players[0].id, r.player.id);
});

test('sweep deletes boards idle past the TTL, with their players', () => {
  const old = boards.create(settings());
  clock.t += BOARD_TTL_MS - 1000;
  const fresh = boards.create(settings());
  clock.t += 2000;
  assert.equal(boards.sweep(), 1);
  assert.equal(boards.exists(old.id), false);
  assert.equal(boards.exists(fresh.id), true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM players WHERE board_id = ?').get(old.id).n, 0);
});

test('state events carry a fresh snapshot', () => {
  const r = boards.create(settings());
  events.length = 0;
  boards.mark(r.id, r.player.token, firstReal(boards.get(r.id, { token: r.player.token }).me.card), true);
  const state = named('state').at(-1).data;
  assert.equal(state.players[0].found, 1);
  assert.equal(setMark(0, 0, true), 1);
});
