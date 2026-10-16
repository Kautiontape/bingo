// What this browser remembers: your name, your private board, the keys for shared boards
// you created or joined, and the last board you had open. Storage can be missing (private
// windows, blocked site data), so every access is wrapped and an in-memory copy keeps the
// page working for the visit.

const KEY = 'bingo:v1';
let mem = null;

function read() {
  if (mem) return mem;
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  mem = data && typeof data === 'object' ? data : {};
  if (!mem.boards || typeof mem.boards !== 'object') mem.boards = {};
  return mem;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
  } catch {}
}

export const store = {
  get name() {
    return read().name ?? '';
  },
  set name(v) {
    read().name = v;
    write();
  },

  /** 'private' or a shared board id. */
  get last() {
    return read().last ?? null;
  },
  set last(v) {
    read().last = v;
    write();
  },

  get priv() {
    return read().priv ?? null;
  },
  set priv(v) {
    read().priv = v;
    write();
  },

  /** { creatorKey?, token?, playerId? } for a shared board. */
  board(id) {
    return read().boards[id] ?? {};
  },
  saveBoard(id, patch) {
    const all = read().boards;
    all[id] = { ...(all[id] ?? {}), ...patch };
    write();
  },
  forgetPlayer(id) {
    const b = read().boards[id];
    if (!b) return;
    delete b.token;
    delete b.playerId;
    write();
  },
};
