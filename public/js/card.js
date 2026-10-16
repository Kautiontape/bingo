// Pure card logic. The server imports this file too, so the browser and the server
// can't disagree about what counts as a bingo.
//
// A card is an array of size*size cells: item text, or null for the free center square.
// Marks are a bitmask (bit i = cell i). 5x5 needs 25 bits, so plain numbers are fine.

export const SIZES = [3, 4, 5];
export const MODES = ['cards', 'shared'];
export const LIMITS = { items: 200, item: 80, title: 60, name: 30, freeText: 40 };
export const DEFAULT_FREE_TEXT = 'Free space ★';

export const hasFree = (size, free) => Boolean(free) && size % 2 === 1;
export const freeIndex = (size, free) => (hasFree(size, free) ? (size * size - 1) / 2 : -1);
export const needed = (size, free) => size * size - (hasFree(size, free) ? 1 : 0);

/** Trim, collapse whitespace, drop blanks and case-insensitive duplicates. Accepts text or an array. */
export function cleanItems(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split('\n');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function randomInt(n) {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] % n;
}

/** Deal a card from the items, or null when there aren't enough. */
export function deal(items, size, free, rand = randomInt) {
  const pool = cleanItems(items);
  if (pool.length < needed(size, free)) return null;
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const fi = freeIndex(size, free);
  const cells = [];
  let k = 0;
  for (let i = 0; i < size * size; i++) cells.push(i === fi ? null : pool[k++]);
  return cells;
}

const lineCache = new Map();
/** Every row, column and both diagonals, as arrays of cell indexes. */
export function lines(n) {
  if (lineCache.has(n)) return lineCache.get(n);
  const r = [...Array(n).keys()];
  const L = [];
  for (let i = 0; i < n; i++) {
    L.push(r.map((c) => i * n + c));
    L.push(r.map((c) => c * n + i));
  }
  L.push(r.map((i) => i * n + i));
  L.push(r.map((i) => i * n + (n - 1 - i)));
  lineCache.set(n, L);
  return L;
}

export const isMarked = (marks, i) => ((marks >>> i) & 1) === 1;
export const setMark = (marks, i, on) => (on ? marks | (1 << i) : marks & ~(1 << i)) >>> 0;

/** Keep only bits for real (non-free) cells. */
export function cleanMarks(cells, marks) {
  let m = 0;
  cells.forEach((c, i) => {
    if (c !== null && isMarked(marks >>> 0, i)) m = setMark(m, i, true);
  });
  return m;
}

/**
 * Score a card. The free square counts as marked.
 * lines: completed lines · win: Set of cells in completed lines · found/total: real cells marked
 * away: fewest unmarked cells in any line · blackout: every real cell marked
 */
export function score(cells, marks) {
  const n = Math.round(Math.sqrt(cells.length));
  let eff = marks >>> 0;
  cells.forEach((c, i) => {
    if (c === null) eff = setMark(eff, i, true);
  });
  const win = new Set();
  let count = 0;
  let away = n;
  for (const l of lines(n)) {
    const missing = l.reduce((k, i) => k + (isMarked(eff, i) ? 0 : 1), 0);
    if (missing === 0) {
      count++;
      l.forEach((i) => win.add(i));
    }
    away = Math.min(away, missing);
  }
  let found = 0;
  let total = 0;
  cells.forEach((c, i) => {
    if (c === null) return;
    total++;
    if (isMarked(marks, i)) found++;
  });
  return { lines: count, win, found, total, away, blackout: total > 0 && found === total };
}
