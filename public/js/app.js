// The page controller. One board is on screen at a time:
//   private  lives only in this browser (the default people-watching card, or "Make my own")
//   shared   lives on the server at /b/:id; this browser holds a player token and maybe the creator key
//   gone     a shared link that no longer works

import { DEFAULT_FREE_TEXT, cleanItems, deal, isMarked, needed, score, setMark } from './card.js';
import { DEFAULT_TITLE, PEOPLE_WATCHING } from './phrases.js';
import { store } from './store.js';
import { api, connect, createMarkQueue } from './sync.js';
import { createMenu } from './ui/menu.js';
import { createForm } from './ui/create.js';
import { createShare } from './ui/share.js';
import { renderPlayers } from './ui/players.js';
import { createConfetti } from './ui/confetti.js';
import { toast } from './ui/toast.js';
import { wireClose } from './ui/dialog.js';

const $ = (s) => document.querySelector(s);
const FONT_SCALE = { 3: 5.4, 4: 4.0, 5: 3.2 };
const ID_RE = /^\/b\/([A-Za-z0-9]{4,24})\/?$/;

const els = {
  app: $('#app'), title: $('#title'), sub: $('#sub'), meta: $('#meta'), board: $('#board'), grid: $('#grid'),
  count: $('#count'), pill: $('#bingo'), doneEditing: $('#doneEditing'), gone: $('#gone'),
  cta: $('#cta'), ctaHead: $('#ctaHead'), ctaSub: $('#ctaSub'), ctaActions: $('#ctaActions'),
  stopConfetti: $('#stopConfetti'), players: $('#players'), playerList: $('#playerList'),
};

const menu = createMenu($('#menuBtn'), $('#menu'));
const form = createForm({ onSubmit: submitBoardForm });
const share = createShare();
const confetti = createConfetti($('#confetti'));

let S = { kind: 'loading' };
let editing = false;
let popIdx = -1;
let seen = { key: '', lines: 0 }; // last bingo count rendered, to spot a new bingo
let dismissed = ''; // confetti stopped for this board + bingo count

// --- Private boards ------------------------------------------------------------------------------

function freshPrivate(src = {}) {
  const b = {
    title: src.title || DEFAULT_TITLE,
    items: src.items ?? PEOPLE_WATCHING.slice(),
    size: src.size ?? 5,
    free: src.free ?? true,
    freeText: src.freeText || DEFAULT_FREE_TEXT,
    mode: src.mode ?? 'cards',
    marks: 0,
  };
  b.cells = deal(b.items, b.size, b.free) ?? deal(PEOPLE_WATCHING, 5, true);
  if (b.cells.length !== b.size * b.size) Object.assign(b, { items: PEOPLE_WATCHING.slice(), size: 5, free: true });
  return b;
}

function loadPrivate() {
  const b = store.priv;
  const ok = b && Array.isArray(b.items) && Array.isArray(b.cells) && b.cells.length === b.size * b.size;
  if (ok) return b;
  const fresh = freshPrivate();
  store.priv = fresh;
  return fresh;
}

const savePrivate = () => {
  if (S.kind === 'private') store.priv = S.board;
};

// --- What's on screen ----------------------------------------------------------------------------

const isOwner = () => S.kind === 'private' || (S.kind === 'shared' && S.isCreator);
const settingsOf = (b) => ({ title: b.title, items: b.items, size: b.size, free: b.free, freeText: b.freeText, mode: b.mode });

/** The card on screen: cells, marks (with unsent marks applied), and who marked what. */
function view() {
  if (S.kind === 'private') {
    const b = S.board;
    return { ...settingsOf(b), cells: b.cells, marks: b.marks, by: null, key: 'private' };
  }
  if (S.kind !== 'shared' || !S.board) return null;
  const b = S.board;
  const key = `${b.id}:${b.rev}`;
  let cells, marks, by = null;
  if (b.mode === 'shared') {
    cells = b.shared.cells;
    marks = b.shared.marks;
    by = b.shared.by.slice();
  } else {
    if (!S.me?.card) return null;
    cells = S.me.card;
    marks = S.me.marks;
  }
  for (const [cell, on] of S.queue.pending) {
    marks = setMark(marks, cell, on);
    if (by) by[cell] = on ? by[cell] ?? S.me?.id : null;
  }
  return { ...settingsOf(b), cells, marks, by, key };
}

function anyMarked() {
  if (S.kind === 'shared') return true; // someone else may have marks we can't see
  const v = view();
  return Boolean(v && v.marks);
}

// --- Rendering -----------------------------------------------------------------------------------

function render(focusIdx) {
  const v = view();
  els.app.setAttribute('aria-busy', String(S.kind === 'loading' || (S.kind === 'shared' && !v)));
  renderHeader(v);
  els.gone.hidden = S.kind !== 'gone';
  els.board.hidden = S.kind === 'gone';
  if (S.kind !== 'gone') renderGrid(v, focusIdx);
  const sc = v ? score(v.cells, v.marks) : null;
  renderStatus(v, sc);
  renderCelebration(v, sc);
  renderPlayers(els.players, els.playerList, {
    board: S.kind === 'shared' ? S.board : null,
    meId: S.me?.id,
    online: new Set(S.online ?? []),
  });
  menu.set(menuEntries());
}

function renderHeader(v) {
  const title = v?.title ?? S.board?.title ?? (S.kind === 'gone' ? 'Bingo' : S.kind === 'shared' ? 'Loading…' : DEFAULT_TITLE);
  els.title.textContent = title;
  document.title = /bingo/i.test(title) ? title : `${title} · Bingo`;
  if (S.kind === 'gone') els.sub.textContent = '';
  else if (editing) els.sub.textContent = 'Tap any square to rewrite it. Tap Done editing when you’re finished.';
  else if (v) els.sub.textContent = `Tap a square when you spot it. ${v.size} in a row, column or diagonal wins.`;
  else els.sub.textContent = 'Getting your card…';
  els.sub.hidden = S.kind === 'gone';

  els.meta.textContent = '';
  els.meta.hidden = !(S.kind === 'shared' && S.board);
  if (els.meta.hidden) return;
  const b = S.board;
  const online = new Set(S.online ?? []);
  const here = b.players.filter((p) => online.has(p.id)).length;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = `${b.mode === 'shared' ? 'One shared card' : 'Everyone gets a card'} · ${b.players.length} playing${here > 1 ? `, ${here} here now` : ''}`;
  els.meta.append(badge);
  if (S.me) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'me-chip';
    chip.title = 'Change your name';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.setProperty('--c', S.me.color);
    chip.append(dot, `You: ${S.me.name} ✎`);
    chip.addEventListener('click', openRename);
    els.meta.append(chip);
  }
}

function renderGrid(v, focusIdx) {
  const grid = els.grid;
  // Don't rebuild under someone who is typing in a square.
  if (editing && grid.contains(document.activeElement)) return;
  grid.classList.toggle('editing', editing);
  grid.classList.toggle('loading', !v);
  const size = v?.size ?? 5;
  grid.style.setProperty('--n', size);
  grid.style.setProperty('--fs', FONT_SCALE[size] ?? 3.2);
  grid.textContent = '';
  if (!v) {
    for (let i = 0; i < 25; i++) grid.append(Object.assign(document.createElement('div'), { className: 'cell' }));
    return;
  }
  const sc = score(v.cells, v.marks);
  const colors = new Map((S.board?.players ?? []).map((p) => [p.id, p.color]));
  v.cells.forEach((text, i) => {
    const free = text === null;
    const on = free || isMarked(v.marks, i);
    const d = document.createElement('div');
    d.className = ['cell', on ? 'on' : '', sc.win.has(i) ? 'win' : '', free ? 'free' : '', i === popIdx ? 'pop' : '',
      S.kind === 'shared' && S.queue.pending.has(i) ? 'pending' : ''].filter(Boolean).join(' ');
    d.textContent = free ? v.freeText : text;
    d.dataset.i = i;
    if (editing) {
      d.contentEditable = 'plaintext-only';
      if (d.contentEditable !== 'plaintext-only') d.contentEditable = 'true';
      d.spellcheck = true;
      d.setAttribute('aria-label', 'Edit square');
    } else {
      d.tabIndex = 0;
      d.setAttribute('role', 'gridcell');
      if (!free) d.setAttribute('aria-pressed', String(on));
      else d.setAttribute('aria-label', `${v.freeText} (free square, always marked)`);
    }
    if (v.by && v.by[i] && !free) {
      const dot = document.createElement('span');
      dot.className = 'by';
      dot.style.setProperty('--c', colors.get(v.by[i]) ?? 'var(--muted)');
      const who = S.board.players.find((p) => p.id === v.by[i]);
      if (who) d.title = `Marked by ${who.name}`;
      d.append(dot);
    }
    grid.append(d);
  });
  popIdx = -1;
  if (focusIdx != null) grid.children[focusIdx]?.focus();
}

function renderStatus(v, sc) {
  els.doneEditing.hidden = !editing;
  if (!v || !sc) {
    els.count.textContent = '';
    els.pill.hidden = true;
    return;
  }
  els.count.textContent = `${sc.found} of ${sc.total} spotted`;
  els.pill.hidden = sc.lines === 0;
  els.pill.textContent = sc.blackout ? 'BLACKOUT' : sc.lines > 1 ? `BINGO ×${sc.lines}` : 'BINGO';
}

function renderCelebration(v, sc) {
  const lines = sc?.lines ?? 0;
  const key = v?.key ?? '';
  const sig = `${key}:${lines}`;
  const isNew = key === seen.key && lines > seen.lines;
  seen = { key, lines };

  if (isNew) {
    els.pill.classList.remove('pop');
    void els.pill.offsetWidth;
    els.pill.classList.add('pop');
  }
  const winning = lines > 0 && S.kind !== 'gone';
  els.cta.hidden = !winning;
  if (!winning) {
    confetti.stop();
    dismissed = ''; // the next bingo gets its confetti, even with the same line count
    return;
  }
  els.ctaHead.textContent = sc.blackout ? 'BLACKOUT!' : lines > 1 ? `BINGO ×${lines}!` : 'BINGO!';
  els.ctaSub.textContent = isOwner() ? 'Go again, or make a board of your own.' : 'Make your own copy, or start something new.';
  renderCtaActions();
  if (dismissed !== sig && !editing) confetti.rain();
  els.stopConfetti.hidden = !confetti.raining;
}

function renderCtaActions() {
  const btn = (label, onClick, primary) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'btn primary glow' : 'btn glow';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  els.ctaActions.textContent = '';
  if (isOwner()) els.ctaActions.append(btn(S.kind === 'shared' ? 'New round for everyone' : 'Shuffle a new card', newRound, true));
  else els.ctaActions.append(btn('Make my own', makeMyOwn, true));
  els.ctaActions.append(btn('Create a board', openCreate));
}

els.stopConfetti.addEventListener('click', () => {
  const v = view();
  if (v) dismissed = `${v.key}:${score(v.cells, v.marks).lines}`;
  confetti.stop();
  els.stopConfetti.hidden = true;
});

function menuEntries() {
  const create = { label: 'Create custom board', hint: 'Your own list, size and mode', onSelect: openCreate, feature: true };
  if (S.kind === 'gone' || S.kind === 'loading') return [create];
  const shared = S.kind === 'shared';
  const sharedCard = shared && S.board?.mode === 'shared';
  const entries = [
    { label: 'Share & QR', hint: shared ? 'Invite people to this board' : 'Get a link so friends can play', onSelect: openShare, feature: true },
  ];
  if (isOwner()) {
    entries.push(
      {
        label: shared ? 'New round' : 'Shuffle new card',
        hint: sharedCard ? 'Deal a new shared card' : shared ? 'New cards for everyone' : 'Deal a fresh card from the list',
        onSelect: newRound,
        confirm: { label: shared ? 'Tap again: resets everyone' : 'Tap again to reshuffle', when: anyMarked },
      },
      {
        label: 'Clear marks',
        hint: shared ? 'Clears everyone’s marks' : 'Keep the card, clear the marks',
        onSelect: clearMarks,
        confirm: { label: shared ? 'Tap again: clears everyone' : 'Tap again to clear', when: anyMarked },
      },
      { label: editing ? 'Done editing' : 'Edit squares', hint: 'Fix the text on a square', onSelect: toggleEditing },
      { label: 'Edit board', hint: 'Title, list, size, free square', onSelect: openEditBoard },
    );
  } else {
    entries.push({ label: 'Make my own', hint: 'Copy this list into your own private board', onSelect: makeMyOwn });
  }
  entries.push('sep', create);
  if (shared) entries.push({ href: '/mine', label: 'Back to my private board' });
  return entries;
}

// --- Playing -------------------------------------------------------------------------------------

function tap(i) {
  if (editing) return;
  const v = view();
  if (!v || v.cells[i] === null) return;
  const on = !isMarked(v.marks, i);
  if (on) popIdx = i;
  if (S.kind === 'private') {
    S.board.marks = setMark(S.board.marks, i, on);
    savePrivate();
  } else if (S.kind === 'shared' && S.me) {
    S.queue.push(i, on);
  } else return;
  render(i);
}

els.grid.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (cell && cell.dataset.i != null) tap(Number(cell.dataset.i));
});
els.grid.addEventListener('keydown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  if (editing) {
    if (e.key === 'Enter') {
      e.preventDefault();
      cell.blur();
    }
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    tap(Number(cell.dataset.i));
  }
});

// Edit squares: save a square's new text when it loses focus.
els.grid.addEventListener('focusout', (e) => {
  const cell = e.target.closest('.cell');
  if (!editing || !cell) return;
  const i = Number(cell.dataset.i);
  const v = view();
  if (!v) return;
  const isFree = v.cells[i] === null;
  const old = isFree ? v.freeText : v.cells[i];
  const text = cell.textContent.replace(/\s+/g, ' ').trim();
  if (!text || text === old) {
    cell.textContent = old;
    return;
  }
  const limit = isFree ? 40 : 80;
  if (text.length > limit) {
    toast(`Squares can be at most ${limit} characters.`);
    cell.textContent = old;
    return;
  }
  if (!isFree && v.items.some((x) => x !== old && x.toLowerCase() === text.toLowerCase())) {
    toast(`“${text}” is already on the list.`);
    cell.textContent = old;
    return;
  }
  if (S.kind === 'private') {
    const b = S.board;
    if (isFree) b.freeText = text;
    else {
      b.cells[i] = text;
      b.items = b.items.includes(old) ? b.items.map((x) => (x === old ? text : x)) : [...b.items, text];
    }
    savePrivate();
    return;
  }
  const req = isFree
    ? api.edit(S.id, S.key, { ...settingsOf(S.board), freeText: text })
    : api.renameItem(S.id, S.key, old, text);
  req.catch((err) => {
    toast(err.message);
    cell.textContent = old;
  });
});

function toggleEditing() {
  editing = !editing;
  if (editing) confetti.stop();
  render();
}
els.doneEditing.addEventListener('click', () => {
  document.activeElement?.blur();
  editing = false;
  render();
});

async function newRound() {
  if (editing) toggleEditing();
  if (S.kind === 'private') {
    const b = S.board;
    b.cells = deal(b.items, b.size, b.free) ?? b.cells;
    b.marks = 0;
    savePrivate();
    render();
    return;
  }
  try {
    S.queue.clear();
    await api.round(S.id, S.key);
    toast('New round! Everyone has a fresh card.');
  } catch (err) {
    toast(err.message);
  }
}

async function clearMarks() {
  if (S.kind === 'private') {
    S.board.marks = 0;
    savePrivate();
    render();
    return;
  }
  try {
    S.queue.clear();
    await api.clear(S.id, S.key);
  } catch (err) {
    toast(err.message);
  }
}

// --- Boards: create, edit, copy, share -------------------------------------------------------------

function openCreate() {
  form.open({
    kind: 'create',
    values: { title: '', items: [], size: 5, free: true, freeText: DEFAULT_FREE_TEXT, mode: 'cards' },
  });
}

function openEditBoard() {
  if (!S.board) return;
  form.open({ kind: 'edit', values: settingsOf(S.board), lockMode: S.kind === 'shared' });
}

const unreachable = (err) => err.status === 0 || err.status >= 500 || err.status === 429;

async function submitBoardForm(values, kind) {
  if (kind === 'create') {
    let created;
    try {
      created = await api.create({ ...values, name: store.name || undefined });
    } catch (err) {
      if (!unreachable(err)) throw err;
      // Keep their work as a private board and offer the link again from there.
      store.priv = freshPrivate(values);
      go('/mine');
      share.error({ message: err.message, retry: () => shareSelected(values.mode) });
      return;
    }
    adopt(created);
    go(`/b/${created.id}`, { thenShare: true });
    return;
  }

  // Edit board
  if (S.kind === 'private') {
    const b = S.board;
    const redeal = values.size !== b.size || values.free !== b.free || JSON.stringify(values.items) !== JSON.stringify(b.items);
    Object.assign(b, values);
    if (redeal) {
      b.cells = deal(b.items, b.size, b.free);
      b.marks = 0;
    }
    savePrivate();
    render();
    return;
  }
  const { mode, ...settings } = values;
  const r = await api.edit(S.id, S.key, settings);
  toast(r.redeal ? 'Saved. Everyone has a fresh card.' : 'Saved.');
}

function makeMyOwn() {
  const b = S.board;
  if (!b) return;
  store.priv = freshPrivate(settingsOf(b));
  go('/mine');
  toast('Your own copy. Share it whenever you like.');
}

function openShare() {
  if (S.kind === 'private') {
    share.offer({ mode: S.board.mode, onGetLink: shareSelected });
    return;
  }
  if (S.kind !== 'shared' || !S.board) return;
  share.ready({ url: `${location.origin}/b/${S.id}`, qr: api.qrUrl(S.id), mode: S.board.mode, title: S.board.title });
}

/** Turn the private board into a shared one, keeping its card and marks. */
async function shareSelected(mode) {
  if (S.kind !== 'private') return;
  const b = S.board;
  b.mode = mode;
  savePrivate();
  share.loading();
  try {
    const created = await api.create({ ...settingsOf(b), mode, card: b.cells, marks: b.marks, name: store.name || undefined });
    adopt(created);
    store.priv = null; // the board moved to the server; /mine deals a fresh one next time
    go(`/b/${created.id}`, { thenShare: true });
  } catch (err) {
    share.error({ message: err.message, retry: () => shareSelected(mode) });
  }
}

/** Remember the keys for a board this browser just created. */
function adopt(created) {
  store.saveBoard(created.id, { creatorKey: created.creatorKey, token: created.player.token, playerId: created.player.id });
  if (!store.name) store.name = created.player.name;
}

// --- Names ---------------------------------------------------------------------------------------

const nameDlg = $('#nameDlg');
wireClose(nameDlg);

function openRename() {
  $('#nInput').value = S.me?.name ?? '';
  $('#nError').textContent = '';
  nameDlg.showModal();
  $('#nInput').select();
}

$('#nameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#nInput').value.replace(/\s+/g, ' ').trim();
  if (!name) {
    $('#nError').textContent = 'Pick something, anything.';
    return;
  }
  try {
    const r = await api.rename(S.id, S.token, name);
    store.name = r.name;
    if (S.me) S.me.name = r.name;
    nameDlg.close();
    render();
  } catch (err) {
    $('#nError').textContent = err.message;
  }
});

// --- Shared boards: loading, joining, live updates --------------------------------------------------

async function join(st) {
  const r = await api.join(st.id, store.name || undefined);
  st.token = r.player.token;
  st.me = r.me;
  store.saveBoard(st.id, { token: r.player.token, playerId: r.player.id });
  if (!store.name) store.name = r.player.name;
}

async function sendMark(st, cell, on) {
  try {
    const r = await api.mark(st.id, st.token, cell, on);
    if (st.board?.mode === 'cards' && st.me) st.me.marks = r.marks;
  } catch (err) {
    if (err.status !== 401) throw err;
    // Our player was dropped (idle on a full board, or storage was cleared): join again.
    await join(st);
    if (st.board?.mode === 'shared') await api.mark(st.id, st.token, cell, on);
  }
}

let refreshing = false;
async function refreshMe(st) {
  if (refreshing) return;
  refreshing = true;
  try {
    const r = await api.get(st.id, { token: st.token, key: st.key });
    st.board = r.board;
    st.isCreator = r.isCreator;
    st.me = r.me ?? st.me;
    if (S === st) render();
  } catch {}
  refreshing = false;
}

function liveHandlers(st) {
  const mine = (fn) => (data) => {
    if (S === st) fn(data);
  };
  return {
    state: mine((snap) => {
      const { online, ...board } = snap;
      st.board = board;
      st.online = online;
      if (st.me) {
        const me = board.players.find((p) => p.id === st.me.id);
        if (me) {
          st.me.name = me.name;
          st.me.color = me.color;
          if (board.mode === 'cards') {
            if (board.rev !== st.me.rev) refreshMe(st);
            else st.me.marks = me.marks;
          }
        }
      }
      render();
    }),
    join: mine((d) => {
      if (d.playerId !== st.me?.id) toast(`${d.name} joined`);
    }),
    bingo: mine((d) => {
      if (d.playerId === st.me?.id) return; // your own confetti says it
      toast(d.blackout ? `${d.name} got a BLACKOUT!` : `${d.name} got BINGO!`, { big: true });
    }),
    round: mine(() => {
      st.queue.clear();
      dismissed = '';
      if (!st.isCreator) toast('New round! Fresh cards dealt.');
    }),
    clear: mine(() => {
      st.queue.clear();
      if (!st.isCreator) toast('Marks cleared for a fresh start.');
    }),
    board: mine((d) => {
      if (!st.isCreator) toast(d.redeal ? 'The board changed. New cards dealt.' : 'The board was updated.');
    }),
    open: mine(() => st.queue.flush()),
    gone: mine(() => showGone(st.id)),
  };
}

async function openShared(id, { thenShare = false } = {}) {
  const saved = store.board(id);
  const st = {
    kind: 'shared', id, board: null, me: null, online: [], isCreator: false,
    key: saved.creatorKey, token: saved.token, live: null, queue: null,
  };
  st.queue = createMarkQueue(
    (cell, on) => sendMark(st, cell, on),
    (err) => {
      if (err) toast(err.message);
      if (S === st) render();
    },
  );
  S = st;
  render();
  try {
    const r = await api.get(id, { token: st.token, key: st.key });
    if (S !== st) return;
    st.board = r.board;
    st.isCreator = r.isCreator;
    st.me = r.me;
    if (!st.me) {
      try {
        await join(st);
      } catch (err) {
        if (S !== st) return;
        if (err.status === 409) return showGone(id, { title: 'This board is full.', text: err.message });
        throw err;
      }
    }
    if (S !== st) return;
    store.last = id;
    st.live = connect(id, st.me?.id, liveHandlers(st));
    render();
    if (thenShare) openShare();
  } catch (err) {
    if (S !== st) return;
    if (err.status === 404) return showGone(id);
    showGone(id, { title: 'Couldn’t load this board.', text: `${err.message} Then reload the page.`, keep: true });
  }
}

function showGone(id, {
  title = 'This board’s gone.',
  text = 'Shared boards disappear after 90 days without anyone playing, or the link might be mistyped.',
  keep = false,
} = {}) {
  S.live?.close?.();
  if (!keep && store.last === id) store.last = 'private';
  S = { kind: 'gone', id };
  editing = false;
  confetti.stop();
  els.gone.querySelector('h2').textContent = title;
  els.gone.querySelector('p').textContent = text;
  render();
}

// --- Routing -------------------------------------------------------------------------------------

function go(path, opts) {
  history.pushState(null, '', path);
  route(opts);
}

function route(opts = {}) {
  S.live?.close?.();
  S.queue?.clear?.();
  editing = false;
  dismissed = '';
  confetti.stop();
  menu.close(false);
  const m = location.pathname.match(ID_RE);
  if (m) return openShared(m[1], opts);
  if (location.pathname === '/' && store.last && store.last !== 'private') {
    history.replaceState(null, '', `/b/${store.last}`);
    return openShared(store.last, opts);
  }
  if (location.pathname !== '/' && location.pathname !== '/mine') history.replaceState(null, '', '/');
  S = { kind: 'private', board: loadPrivate() };
  store.last = 'private';
  render();
}

addEventListener('popstate', () => route());
route();
