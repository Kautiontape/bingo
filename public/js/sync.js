// Talking to the server: JSON API calls, the live-update stream, and a queue that keeps
// marks safe while the connection is down.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(method, path, { body, token, key } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['x-player-token'] = token;
  if (key) headers['x-creator-key'] = key;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Something went wrong (${res.status}).`);
  return data;
}

const base = (id) => `/api/boards/${encodeURIComponent(id)}`;

export const api = {
  create: (settings) => call('POST', '/api/boards', { body: settings }),
  get: (id, auth = {}) => call('GET', base(id), auth),
  join: (id, name) => call('POST', `${base(id)}/join`, { body: { name } }),
  mark: (id, token, cell, on) => call('POST', `${base(id)}/mark`, { token, body: { cell, on } }),
  rename: (id, token, name) => call('PATCH', `${base(id)}/me`, { token, body: { name } }),
  round: (id, key) => call('POST', `${base(id)}/round`, { key }),
  clear: (id, key) => call('POST', `${base(id)}/clear`, { key }),
  edit: (id, key, settings) => call('PUT', base(id), { key, body: settings }),
  renameItem: (id, key, from, to) => call('POST', `${base(id)}/rename-item`, { key, body: { from, to } }),
  qrUrl: (id) => `${base(id)}/qr.svg`,
};

const EVENTS = ['state', 'join', 'bingo', 'round', 'clear', 'board'];

/**
 * Live updates for one board, reconnecting on its own.
 * handlers: { state, join, bingo, round, clear, board, open, gone }
 */
export function connect(id, playerId, handlers) {
  let es = null;
  let closed = false;
  let timer = 0;
  let delay = 1000;

  function open() {
    if (closed) return;
    es?.close();
    es = new EventSource(`${base(id)}/events${playerId ? `?p=${encodeURIComponent(playerId)}` : ''}`);
    es.addEventListener('open', () => {
      delay = 1000;
      handlers.open?.();
    });
    for (const name of EVENTS) {
      es.addEventListener(name, (e) => {
        try {
          handlers[name]?.(JSON.parse(e.data));
        } catch (err) {
          console.error(err);
        }
      });
    }
    // The browser retries dropped connections by itself. It gives up (CLOSED) when the
    // server answers with an error, e.g. the board was deleted.
    es.addEventListener('error', () => {
      if (closed || es.readyState !== EventSource.CLOSED) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await api.get(id);
        } catch (err) {
          if (err.status === 404) return handlers.gone?.();
        }
        delay = Math.min(delay * 2, 30_000);
        open();
      }, delay);
    });
  }

  // A phone waking the page back up shouldn't wait out the backoff.
  const wake = () => {
    if (document.visibilityState === 'visible' && es?.readyState === EventSource.CLOSED) {
      clearTimeout(timer);
      open();
    }
  };
  document.addEventListener('visibilitychange', wake);
  open();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      es?.close();
      document.removeEventListener('visibilitychange', wake);
    },
  };
}

/**
 * Marks waiting to reach the server, newest value per square. Each send is an explicit
 * on/off, so resending after a failure is always safe.
 * send(cell, on) does the request; onChange(error?) runs after every change.
 */
export function createMarkQueue(send, onChange) {
  const pending = new Map();
  let busy = false;
  let timer = 0;
  let delay = 1000;

  async function flush() {
    if (busy) return;
    busy = true;
    clearTimeout(timer);
    try {
      while (pending.size) {
        const [cell, on] = pending.entries().next().value;
        try {
          await send(cell, on);
          if (pending.get(cell) === on) pending.delete(cell);
          delay = 1000;
          onChange();
        } catch (err) {
          // The server refused this mark for good (e.g. a new round changed the card): drop it.
          if (err.status >= 400 && err.status < 500 && err.status !== 429) {
            pending.delete(cell);
            onChange(err);
            continue;
          }
          timer = setTimeout(flush, delay);
          delay = Math.min(delay * 2, 15_000);
          break;
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    pending,
    push(cell, on) {
      pending.set(cell, on);
      flush();
    },
    flush,
    clear() {
      pending.clear();
      clearTimeout(timer);
    },
  };
}
