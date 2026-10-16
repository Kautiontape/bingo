// Game rules over the database. No HTTP here: routes.js validates the request shape and
// maps BoardError to a status code.

import { createHash, randomBytes } from 'node:crypto';
import {
  SIZES, MODES, LIMITS, DEFAULT_FREE_TEXT,
  cleanItems, cleanMarks, deal, freeIndex, isMarked, needed, randomInt, score, setMark,
} from '../public/js/card.js';
import { COLORS, funName } from '../public/js/phrases.js';

export class BoardError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const MAX_PLAYERS = 50;
export const PLAYER_IDLE_MS = DAY;
export const BOARD_TTL_MS = 90 * DAY;

// No 0/O/1/l/I, so ids survive being read aloud or retyped.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomId = (len) => [...randomBytes(len)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
const newSecret = () => randomBytes(16).toString('base64url');
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

function fail(status, message) {
  throw new BoardError(status, message);
}

export function validateSettings(input) {
  const i = input && typeof input === 'object' ? input : {};
  const title = str(i.title) || 'Bingo';
  if (title.length > LIMITS.title) fail(400, `Titles can be at most ${LIMITS.title} characters.`);
  const size = Number(i.size);
  if (!SIZES.includes(size)) fail(400, 'Size must be 3, 4 or 5.');
  const free = Boolean(i.free);
  const freeText = str(i.freeText) || DEFAULT_FREE_TEXT;
  if (freeText.length > LIMITS.freeText) fail(400, `Free square text can be at most ${LIMITS.freeText} characters.`);
  if (!Array.isArray(i.items) && typeof i.items !== 'string') fail(400, 'Items must be a list.');
  const items = cleanItems(i.items);
  if (items.length > LIMITS.items) fail(400, `A board can have at most ${LIMITS.items} items.`);
  if (items.some((s) => s.length > LIMITS.item)) fail(400, `Items can be at most ${LIMITS.item} characters.`);
  const need = needed(size, free);
  if (items.length < need) fail(400, `A ${size}×${size} card needs ${need} items. This list has ${items.length}.`);
  const mode = i.mode ?? 'cards';
  if (!MODES.includes(mode)) fail(400, 'Mode must be "cards" or "shared".');
  return { title, items, size, free, freeText, mode };
}

/** A card sent by the client is kept only if it could have been dealt from these settings. */
function acceptCard(cells, s) {
  if (!Array.isArray(cells) || cells.length !== s.size * s.size) return null;
  const fi = freeIndex(s.size, s.free);
  const allowed = new Set(s.items);
  const seen = new Set();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (i === fi) {
      if (c !== null) return null;
      continue;
    }
    if (typeof c !== 'string' || !allowed.has(c) || seen.has(c)) return null;
    seen.add(c);
  }
  return cells;
}

const parseBoard = (row) =>
  row && {
    id: row.id,
    creatorKeyHash: row.creator_key_hash,
    mode: row.mode,
    title: row.title,
    items: JSON.parse(row.items),
    size: row.size,
    free: Boolean(row.free),
    freeText: row.free_text,
    rev: row.rev,
    shared:
      row.mode === 'shared'
        ? { cells: JSON.parse(row.shared_card), marks: row.shared_marks, by: JSON.parse(row.shared_by) }
        : null,
    lastActive: row.last_active,
  };

const parsePlayer = (row) =>
  row && {
    id: row.id,
    name: row.name,
    color: row.color,
    card: row.card ? JSON.parse(row.card) : null,
    marks: row.marks,
    updatedAt: row.updated_at,
  };

/**
 * publish(boardId, event, data) receives every change. For 'state', data is a function
 * that builds the snapshot, so nothing is computed when nobody is listening.
 */
export function createBoards(db, { publish = () => {}, now = Date.now, rand = randomInt } = {}) {
  const q = {
    insertBoard: db.prepare(`
      INSERT INTO boards (id, creator_key_hash, mode, title, items, size, free, free_text,
                          shared_card, shared_marks, shared_by, created_at, last_active)
      VALUES (@id, @creator_key_hash, @mode, @title, @items, @size, @free, @free_text,
              @shared_card, 0, @shared_by, @now, @now)`),
    board: db.prepare('SELECT * FROM boards WHERE id = ?'),
    touch: db.prepare('UPDATE boards SET last_active = ? WHERE id = ?'),
    settings: db.prepare(`
      UPDATE boards SET title = @title, items = @items, size = @size, free = @free, free_text = @free_text
      WHERE id = @id`),
    items: db.prepare('UPDATE boards SET items = ? WHERE id = ?'),
    bumpRev: db.prepare('UPDATE boards SET rev = rev + 1 WHERE id = ?'),
    shared: db.prepare('UPDATE boards SET shared_card = ?, shared_marks = ?, shared_by = ? WHERE id = ?'),
    sweep: db.prepare('DELETE FROM boards WHERE last_active < ?'),

    players: db.prepare('SELECT * FROM players WHERE board_id = ? ORDER BY created_at, rowid'),
    playerByToken: db.prepare('SELECT * FROM players WHERE board_id = ? AND token_hash = ?'),
    insertPlayer: db.prepare(`
      INSERT INTO players (board_id, id, token_hash, name, color, card, marks, created_at, updated_at)
      VALUES (@board_id, @id, @token_hash, @name, @color, @card, @marks, @now, @now)`),
    dropIdle: db.prepare('DELETE FROM players WHERE board_id = ? AND updated_at < ?'),
    playerMarks: db.prepare('UPDATE players SET marks = ?, updated_at = ? WHERE board_id = ? AND id = ?'),
    playerSeen: db.prepare('UPDATE players SET updated_at = ? WHERE board_id = ? AND id = ?'),
    playerName: db.prepare('UPDATE players SET name = ?, updated_at = ? WHERE board_id = ? AND id = ?'),
    playerCard: db.prepare('UPDATE players SET card = ?, marks = ? WHERE board_id = ? AND id = ?'),
    clearPlayers: db.prepare('UPDATE players SET marks = 0 WHERE board_id = ?'),
  };

  const players = (id) => q.players.all(id).map(parsePlayer);
  const touch = (id) => q.touch.run(now(), id);
  const emitState = (id) => publish(id, 'state', () => snapshot(id));

  function load(id) {
    const b = parseBoard(q.board.get(String(id)));
    if (!b) fail(404, 'This board is gone.');
    return b;
  }
  const isCreator = (b, key) => typeof key === 'string' && key.length > 0 && sha(key) === b.creatorKeyHash;
  function asCreator(id, key) {
    const b = load(id);
    if (!isCreator(b, key)) fail(403, 'Only the board’s creator can do that.');
    return b;
  }
  function asPlayer(b, token) {
    const p = typeof token === 'string' && token ? parsePlayer(q.playerByToken.get(b.id, sha(token))) : null;
    if (!p) fail(401, 'Join the board first.');
    return p;
  }

  function cleanName(name) {
    const n = str(name);
    if (n.length > LIMITS.name) fail(400, `Names can be at most ${LIMITS.name} characters.`);
    return n;
  }

  function addPlayer(b, { name, card = null, marks = 0 }, existing) {
    const taken = new Set(existing.map((p) => p.name.toLowerCase()));
    let picked = str(name).slice(0, LIMITS.name);
    for (let k = 0; !picked && k < 12; k++) {
      const n = funName(rand);
      if (!taken.has(n.toLowerCase()) || k === 11) picked = n;
    }
    const used = new Set(existing.map((p) => p.color));
    const palette = COLORS.filter((c) => !used.has(c));
    const color = (palette.length ? palette : COLORS)[rand((palette.length ? palette : COLORS).length)];
    const cells = b.mode === 'cards' ? card ?? deal(b.items, b.size, b.free, rand) : null;
    const m = cells ? cleanMarks(cells, marks) : 0;
    const player = { id: randomId(8), token: newSecret(), name: picked, color };
    q.insertPlayer.run({
      board_id: b.id, id: player.id, token_hash: sha(player.token), name: player.name, color,
      card: cells && JSON.stringify(cells), marks: m, now: now(),
    });
    return { ...player, card: cells, marks: m };
  }

  // Deal fresh cards with the board's current settings and clear every mark.
  function dealAll(b) {
    if (b.mode === 'cards') {
      for (const p of players(b.id)) q.playerCard.run(JSON.stringify(deal(b.items, b.size, b.free, rand)), 0, b.id, p.id);
    } else {
      const cells = deal(b.items, b.size, b.free, rand);
      q.shared.run(JSON.stringify(cells), 0, JSON.stringify(cells.map(() => null)), b.id);
    }
  }

  const meOf = (b, p) => ({ id: p.id, name: p.name, color: p.color, card: p.card, marks: p.marks, rev: b.rev });

  function snapshot(id) {
    const b = parseBoard(q.board.get(String(id)));
    if (!b) return null;
    return {
      id: b.id,
      title: b.title,
      items: b.items,
      size: b.size,
      free: b.free,
      freeText: b.freeText,
      mode: b.mode,
      rev: b.rev,
      shared: b.shared,
      players: players(b.id).map((p) => {
        const base = { id: p.id, name: p.name, color: p.color };
        if (b.mode === 'shared') return { ...base, marked: b.shared.by.filter((x) => x === p.id).length };
        const s = score(p.card, p.marks);
        return { ...base, marks: p.marks, found: s.found, total: s.total, lines: s.lines, away: s.away, blackout: s.blackout };
      }),
    };
  }

  const createTx = db.transaction((input) => {
    const s = validateSettings(input);
    const id = randomId(10);
    const creatorKey = newSecret();
    const card = acceptCard(input?.card, s) ?? deal(s.items, s.size, s.free, rand);
    const marks = cleanMarks(card, Number(input?.marks) >>> 0);
    q.insertBoard.run({
      id, creator_key_hash: sha(creatorKey), mode: s.mode, title: s.title, items: JSON.stringify(s.items),
      size: s.size, free: s.free ? 1 : 0, free_text: s.freeText,
      shared_card: s.mode === 'shared' ? JSON.stringify(card) : null,
      shared_by: s.mode === 'shared' ? JSON.stringify(card.map(() => null)) : null,
      now: now(),
    });
    const b = load(id);
    const player = addPlayer(b, { name: input?.name, card: s.mode === 'cards' ? card : null, marks }, []);
    if (s.mode === 'shared' && marks) {
      q.shared.run(JSON.stringify(card), marks, JSON.stringify(card.map((_, i) => (isMarked(marks, i) ? player.id : null))), id);
    }
    return { id, creatorKey, player: { id: player.id, token: player.token, name: player.name, color: player.color } };
  });

  const joinTx = db.transaction((id, name) => {
    const b = load(id);
    let existing = players(b.id);
    if (existing.length >= MAX_PLAYERS) {
      q.dropIdle.run(b.id, now() - PLAYER_IDLE_MS);
      existing = players(b.id);
    }
    if (existing.length >= MAX_PLAYERS) fail(409, `This board is full (${MAX_PLAYERS} players).`);
    const p = addPlayer(b, { name }, existing);
    touch(b.id);
    return { b, p };
  });

  const markTx = db.transaction((id, token, cell, on) => {
    const b = load(id);
    const p = asPlayer(b, token);
    if (!Number.isInteger(cell) || cell < 0 || cell >= b.size * b.size) fail(400, 'No such square.');
    if (cell === freeIndex(b.size, b.free)) fail(400, 'The free square is always marked.');
    if (typeof on !== 'boolean') fail(400, 'Say whether the square is on or off.');
    const t = now();
    let before, after, marks;
    if (b.mode === 'cards') {
      before = score(p.card, p.marks);
      marks = setMark(p.marks, cell, on);
      after = score(p.card, marks);
      q.playerMarks.run(marks, t, b.id, p.id);
    } else {
      const { cells, by } = b.shared;
      before = score(cells, b.shared.marks);
      marks = setMark(b.shared.marks, cell, on);
      after = score(cells, marks);
      const nextBy = by.slice();
      if (on && !isMarked(b.shared.marks, cell)) nextBy[cell] = p.id;
      if (!on) nextBy[cell] = null;
      q.shared.run(JSON.stringify(cells), marks, JSON.stringify(nextBy), b.id);
      q.playerSeen.run(t, b.id, p.id);
    }
    touch(b.id);
    return { b, p, before, after, marks };
  });

  const renameTx = db.transaction((id, token, name) => {
    const b = load(id);
    const p = asPlayer(b, token);
    const n = cleanName(name);
    if (!n) fail(400, 'Names can’t be blank.');
    q.playerName.run(n, now(), b.id, p.id);
    touch(b.id);
    return n;
  });

  const roundTx = db.transaction((id, key) => {
    const b = asCreator(id, key);
    dealAll(b);
    q.bumpRev.run(b.id);
    touch(b.id);
  });

  const clearTx = db.transaction((id, key) => {
    const b = asCreator(id, key);
    if (b.mode === 'cards') q.clearPlayers.run(b.id);
    else q.shared.run(JSON.stringify(b.shared.cells), 0, JSON.stringify(b.shared.cells.map(() => null)), b.id);
    touch(b.id);
  });

  const editTx = db.transaction((id, key, input) => {
    const b = asCreator(id, key);
    const s = validateSettings({ ...input, mode: b.mode });
    const redeal = s.size !== b.size || s.free !== b.free || JSON.stringify(s.items) !== JSON.stringify(b.items);
    q.settings.run({
      id: b.id, title: s.title, items: JSON.stringify(s.items), size: s.size, free: s.free ? 1 : 0, free_text: s.freeText,
    });
    if (redeal) {
      dealAll({ ...b, ...s });
      q.bumpRev.run(b.id);
    }
    touch(b.id);
    return redeal;
  });

  const renameItemTx = db.transaction((id, key, from, to) => {
    const b = asCreator(id, key);
    const src = str(from);
    const dst = str(to);
    if (!dst) fail(400, 'A square needs some text.');
    if (dst.length > LIMITS.item) fail(400, `Items can be at most ${LIMITS.item} characters.`);
    const idx = b.items.indexOf(src);
    if (idx < 0) fail(404, 'That square isn’t on the list any more.');
    if (src === dst) return false;
    if (b.items.some((x, k) => k !== idx && x.toLowerCase() === dst.toLowerCase())) {
      fail(409, `“${dst}” is already on the list.`);
    }
    const items = b.items.slice();
    items[idx] = dst;
    q.items.run(JSON.stringify(items), b.id);
    const swap = (cells) => cells.map((c) => (c === src ? dst : c));
    if (b.mode === 'cards') {
      for (const p of players(b.id)) {
        if (p.card.includes(src)) q.playerCard.run(JSON.stringify(swap(p.card)), p.marks, b.id, p.id);
      }
    } else {
      q.shared.run(JSON.stringify(swap(b.shared.cells)), b.shared.marks, JSON.stringify(b.shared.by), b.id);
    }
    q.bumpRev.run(b.id);
    touch(b.id);
    return true;
  });

  return {
    snapshot,
    exists: (id) => Boolean(q.board.get(String(id))),

    create(input) {
      return createTx(input ?? {});
    },

    /** Board snapshot plus the caller's own player (by token) and whether they hold the creator key. */
    get(id, { token, key } = {}) {
      const b = load(id);
      if (now() - b.lastActive > HOUR) touch(b.id);
      const p = typeof token === 'string' && token ? parsePlayer(q.playerByToken.get(b.id, sha(token))) : null;
      return { board: snapshot(b.id), me: p ? meOf(b, p) : null, isCreator: isCreator(b, key) };
    },

    join(id, { name } = {}) {
      const { b, p } = joinTx(id, name);
      publish(b.id, 'join', { playerId: p.id, name: p.name, color: p.color });
      emitState(b.id);
      return { player: { id: p.id, token: p.token, name: p.name, color: p.color }, me: meOf(b, p) };
    },

    mark(id, token, cell, on) {
      const { b, p, before, after, marks } = markTx(id, token, cell, on);
      if (after.lines > before.lines) {
        publish(b.id, 'bingo', { playerId: p.id, name: p.name, color: p.color, lines: after.lines, blackout: after.blackout });
      }
      emitState(b.id);
      return { marks };
    },

    rename(id, token, name) {
      const n = renameTx(id, token, name);
      emitState(id);
      return { name: n };
    },

    newRound(id, key) {
      roundTx(id, key);
      publish(id, 'round', {});
      emitState(id);
    },

    clear(id, key) {
      clearTx(id, key);
      publish(id, 'clear', {});
      emitState(id);
    },

    edit(id, key, input) {
      const redeal = editTx(id, key, input ?? {});
      publish(id, 'board', { redeal });
      emitState(id);
      return { redeal };
    },

    renameItem(id, key, from, to) {
      if (renameItemTx(id, key, from, to)) emitState(id);
    },

    /** Delete boards idle longer than the TTL. Returns how many went. */
    sweep() {
      return q.sweep.run(now() - BOARD_TTL_MS).changes;
    },
  };
}
