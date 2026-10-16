import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanItems, cleanMarks, deal, freeIndex, hasFree, isMarked, lines, needed, score, setMark,
} from '../public/js/card.js';
import { PEOPLE_WATCHING } from '../public/js/phrases.js';

const seq = () => {
  let k = 0;
  return (n) => k++ % n;
};

test('cleanItems trims, collapses spaces, drops blanks and case-insensitive duplicates', () => {
  assert.deepEqual(cleanItems('  Dog \n\n dog\nBaby   in  stroller\n'), ['Dog', 'Baby in stroller']);
  assert.deepEqual(cleanItems(['a', ' A ', null, 'b']), ['a', 'b']);
});

test('free square exists only on odd sizes', () => {
  assert.equal(hasFree(5, true), true);
  assert.equal(hasFree(4, true), false);
  assert.equal(hasFree(3, false), false);
  assert.equal(freeIndex(5, true), 12);
  assert.equal(freeIndex(3, true), 4);
  assert.equal(freeIndex(4, true), -1);
  assert.equal(needed(5, true), 24);
  assert.equal(needed(4, true), 16);
});

test('deal fills every cell with a distinct item and leaves the center free', () => {
  const cells = deal(PEOPLE_WATCHING, 5, true);
  assert.equal(cells.length, 25);
  assert.equal(cells[12], null);
  const real = cells.filter((c) => c !== null);
  assert.equal(real.length, 24);
  assert.equal(new Set(real).size, 24);
  real.forEach((c) => assert.ok(PEOPLE_WATCHING.includes(c)));
});

test('deal returns null when the list is too short', () => {
  assert.equal(deal(['a', 'b', 'c'], 3, true), null);
  assert.ok(deal('a\nb\nc\nd\ne\nf\ng\nh', 3, true));
});

test('deal shuffles with the given random source', () => {
  const items = 'a b c d e f g h i'.split(' ');
  assert.deepEqual(deal(items, 3, false, seq()), deal(items, 3, false, seq()));
});

test('lines covers rows, columns and both diagonals', () => {
  const L = lines(3);
  assert.equal(L.length, 8);
  assert.deepEqual(L.at(-2), [0, 4, 8]);
  assert.deepEqual(L.at(-1), [2, 4, 6]);
});

test('marks round-trip through the bitmask', () => {
  let m = 0;
  m = setMark(m, 24, true);
  m = setMark(m, 0, true);
  assert.ok(isMarked(m, 24) && isMarked(m, 0) && !isMarked(m, 5));
  m = setMark(m, 24, false);
  assert.ok(!isMarked(m, 24));
  assert.ok(m >= 0);
});

test('score counts the free square as marked', () => {
  const cells = deal('a b c d e f g h'.split(' '), 3, true);
  // Middle row: 3, [4 free], 5
  let m = setMark(setMark(0, 3, true), 5, true);
  const s = score(cells, m);
  assert.equal(s.lines, 1);
  assert.deepEqual([...s.win].sort(), [3, 4, 5]);
  assert.equal(s.found, 2);
  assert.equal(s.total, 8);
  assert.equal(s.away, 0);
  assert.equal(s.blackout, false);
});

test('score reports how far the best line is from bingo', () => {
  const cells = deal('a b c d e f g h i'.split(' '), 3, false);
  assert.equal(score(cells, 0).away, 3);
  assert.equal(score(cells, setMark(0, 0, true)).away, 2);
});

test('blackout when every real cell is marked', () => {
  const cells = deal('a b c d e f g h'.split(' '), 3, true);
  let m = 0;
  cells.forEach((c, i) => {
    if (c !== null) m = setMark(m, i, true);
  });
  const s = score(cells, m);
  assert.equal(s.blackout, true);
  assert.equal(s.lines, 8);
});

test('cleanMarks drops the free square and out-of-range bits', () => {
  const cells = deal('a b c d e f g h'.split(' '), 3, true);
  assert.equal(cleanMarks(cells, (1 << 4) | (1 << 20) | 1), 1);
});
