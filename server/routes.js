// HTTP layer: request shape, auth headers, rate limits, live events, static files.

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import QRCode from 'qrcode';
import { BoardError } from './boards.js';
import { DEFAULT_TITLE } from '../public/js/phrases.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Read every file under dir into memory once. The whole site is a few dozen small files. */
export function loadStatic(dir) {
  const files = new Map();
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const body = readFileSync(full);
        const path = '/' + relative(dir, full).split(sep).join('/');
        const etag = `"${createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`;
        files.set(path, { body, etag, type: TYPES[extname(full)] ?? 'application/octet-stream' });
      }
    }
  };
  walk(dir);
  return files;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Fixed-window counter per key. */
function limiter(windowMs, max) {
  const hits = new Map();
  const check = (key) => {
    const t = Date.now();
    let h = hits.get(key);
    if (!h || t - h.start >= windowMs) {
      h = { start: t, n: 0 };
      hits.set(key, h);
    }
    h.n++;
    return h.n <= max;
  };
  check.prune = () => {
    const t = Date.now();
    for (const [k, h] of hits) if (t - h.start >= windowMs) hits.delete(k);
  };
  return check;
}

export function createApp({ boards, hub, publicDir, publicUrl = '', heartbeatMs = 25_000, limits = {} }) {
  const files = loadStatic(publicDir);
  const index = files.get('/index.html').body.toString('utf8');
  const limit = {
    create: limiter(3_600_000, limits.create ?? 20),
    join: limiter(3_600_000, limits.join ?? 120),
    write: limiter(60_000, limits.write ?? 240),
  };
  const app = new Hono();

  const ipOf = (c) => c.req.header('x-real-ip') || c.env?.incoming?.socket?.remoteAddress || 'local';
  const originOf = (c) => {
    if (publicUrl) return publicUrl.replace(/\/$/, '');
    const host = c.req.header('host') ?? 'localhost';
    const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '');
    return `${proto}://${host}`;
  };
  const token = (c) => c.req.header('x-player-token') ?? '';
  const key = (c) => c.req.header('x-creator-key') ?? '';
  const tooMany = (c) => c.json({ error: 'Slow down a little and try again in a minute.' }, 429);
  async function body(c) {
    try {
      const b = await c.req.json();
      return b && typeof b === 'object' ? b : {};
    } catch {
      throw new BoardError(400, 'Send JSON.');
    }
  }

  app.onError((err, c) => {
    if (err instanceof BoardError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Something went wrong on our end.' }, 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'That’s too much text.' }, 413) }));
  app.use('/api/*', async (c, next) => {
    await next();
    if (!c.res.headers.get('content-type')?.startsWith('text/event-stream')) c.header('Cache-Control', 'no-store');
  });

  // --- API -------------------------------------------------------------------------------

  app.post('/api/boards', async (c) => {
    if (!limit.create(ipOf(c))) return tooMany(c);
    return c.json(boards.create(await body(c)), 201);
  });

  app.get('/api/boards/:id', (c) => c.json(boards.get(c.req.param('id'), { token: token(c), key: key(c) })));

  app.post('/api/boards/:id/join', async (c) => {
    if (!limit.join(ipOf(c))) return tooMany(c);
    const { name } = await body(c);
    return c.json(boards.join(c.req.param('id'), { name }), 201);
  });

  app.post('/api/boards/:id/mark', async (c) => {
    if (!limit.write(ipOf(c))) return tooMany(c);
    const { cell, on } = await body(c);
    return c.json(boards.mark(c.req.param('id'), token(c), cell, on));
  });

  app.patch('/api/boards/:id/me', async (c) => {
    if (!limit.write(ipOf(c))) return tooMany(c);
    const { name } = await body(c);
    return c.json(boards.rename(c.req.param('id'), token(c), name));
  });

  app.post('/api/boards/:id/round', (c) => {
    if (!limit.write(ipOf(c))) return tooMany(c);
    boards.newRound(c.req.param('id'), key(c));
    return c.json({ ok: true });
  });

  app.post('/api/boards/:id/clear', (c) => {
    if (!limit.write(ipOf(c))) return tooMany(c);
    boards.clear(c.req.param('id'), key(c));
    return c.json({ ok: true });
  });

  app.put('/api/boards/:id', async (c) => {
    if (!limit.write(ipOf(c))) return tooMany(c);
    return c.json(boards.edit(c.req.param('id'), key(c), await body(c)));
  });

  app.post('/api/boards/:id/rename-item', async (c) => {
    if (!limit.write(ipOf(c))) return tooMany(c);
    const { from, to } = await body(c);
    boards.renameItem(c.req.param('id'), key(c), from, to);
    return c.json({ ok: true });
  });

  app.get('/api/boards/:id/qr.svg', async (c) => {
    const id = c.req.param('id');
    if (!boards.exists(id)) return c.json({ error: 'This board is gone.' }, 404);
    const svg = await QRCode.toString(`${originOf(c)}/b/${id}`, {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#241029', light: '#ffffff' },
    });
    return c.body(svg, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
  });

  // Live updates. Every connect starts with a full snapshot, so a client that drops and
  // reconnects is caught up without replaying missed events.
  app.get('/api/boards/:id/events', (c) => {
    const id = c.req.param('id');
    if (!boards.exists(id)) return c.json({ error: 'This board is gone.' }, 404);
    const playerId = (c.req.query('p') ?? '').slice(0, 16) || null;
    const stateNow = () => boards.snapshot(id);
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let open = true;
      const client = {
        playerId,
        send: (event, data) => {
          if (open) stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});
        },
      };
      stream.onAbort(() => {
        open = false;
        hub.remove(id, client);
        if (playerId) hub.publish(id, 'state', stateNow);
      });
      hub.add(id, client);
      // A player coming online changes everyone's view; an anonymous viewer only needs its own snapshot.
      if (playerId) hub.publish(id, 'state', stateNow);
      else client.send('state', { ...stateNow(), online: hub.online(id) });
      while (open) {
        await stream.sleep(heartbeatMs);
        if (open) await stream.write(': ping\n\n').catch(() => {});
      }
    });
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  // --- Pages and static files ----------------------------------------------------------------

  function page(c, board) {
    const origin = originOf(c);
    const title = !board ? DEFAULT_TITLE : /bingo/i.test(board.title) ? board.title : `${board.title} · Bingo`;
    const description = !board
      ? 'Spot it, tap it, shout BINGO. People-watching bingo for anywhere with people.'
      : board.mode === 'shared'
        ? 'Join in and mark the shared card together.'
        : 'Join in. You’ll get your own card from this list.';
    const url = board ? `${origin}/b/${board.id}` : `${origin}/`;
    const meta = [
      `<meta name="description" content="${esc(description)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="bingo.kautiontape.com">`,
      `<meta property="og:title" content="${esc(board ? board.title : DEFAULT_TITLE)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:image" content="${esc(origin)}/og.png">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    ].join('\n');
    const html = index.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`).replace('<!--meta-->', meta);
    return c.html(html, 200, { 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP });
  }

  app.get('/', (c) => page(c, null));
  app.get('/mine', (c) => page(c, null));
  app.get('/b/:id', (c) => page(c, boards.snapshot(c.req.param('id'))));

  app.get('*', (c) => {
    const f = files.get(c.req.path);
    if (!f || c.req.path === '/index.html') return c.text('Not found', 404);
    const headers = { 'Content-Type': f.type, ETag: f.etag, 'Cache-Control': 'no-cache' };
    if (c.req.header('if-none-match') === f.etag) return c.body(null, 304, headers);
    return c.body(f.body, 200, headers);
  });

  // Housekeeping for the rate limiters; index.js calls it on a timer.
  app.prune = () => Object.values(limit).forEach((l) => l.prune());

  return app;
}
