// Confetti on a full-screen canvas that sits behind the page (styles.css). rain() keeps it
// falling until stop(); party() adds fireworks for a blackout. With reduced motion, both
// become one small burst.

const COLORS = ['#D3166F', '#FF4FA3', '#5A1FC4', '#A57CFF', '#F5A524', '#FFC453', '#14B8A6', '#3B82F6'];
const GLYPHS = ['🎉', '👀', '⭐', '✨', '🥳'];

export function createConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let parts = [];
  let raining = false;
  let heavy = false; // blackout: thicker rain while the party lasts
  let fireworks = 0;
  let raf = 0;
  let last = 0;
  let w = 0;
  let h = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize);
  resize();

  const rnd = (a, b) => a + Math.random() * (b - a);

  /** kind: 'rain' drifts down, 'burst' shoots up from below, 'firework' explodes in a ring. */
  function piece(x, y, kind) {
    const glyph = Math.random() < (kind === 'firework' ? 0.04 : 0.08);
    const p = {
      x, y,
      vx: rnd(-0.6, 0.6),
      vy: rnd(1.2, 2.6),
      g: 0.035,
      max: 3.6,
      drag: 0.985,
      rot: rnd(0, Math.PI * 2),
      vr: rnd(-0.18, 0.18),
      flip: rnd(0, Math.PI * 2),
      vf: rnd(0.05, 0.14),
      sway: rnd(0, Math.PI * 2),
      vs: rnd(0.015, 0.045),
      size: glyph ? rnd(18, 26) : rnd(7, 12),
      color: COLORS[(Math.random() * COLORS.length) | 0],
      shape: glyph ? 'glyph' : Math.random() < 0.28 ? 'dot' : 'paper',
      glyph: GLYPHS[(Math.random() * GLYPHS.length) | 0],
    };
    if (kind === 'burst') Object.assign(p, { vx: rnd(-7, 7), vy: rnd(-13, -5), g: 0.32, max: 8 });
    if (kind === 'firework') {
      const a = rnd(0, Math.PI * 2);
      const speed = rnd(3, 10);
      Object.assign(p, { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 1.5, g: 0.16, max: 6, drag: 0.965 });
    }
    return p;
  }

  function draw(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.shape === 'glyph') {
      ctx.font = `${p.size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.rotate(Math.sin(p.rot) * 0.4);
      ctx.fillText(p.glyph, 0, 0);
    } else {
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'dot') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.scale(1, Math.cos(p.flip)); // paper turning over as it falls
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
    }
    ctx.restore();
  }

  function frame(t) {
    const dt = last ? Math.min((t - last) / 16.67, 3) : 1;
    last = t;
    ctx.clearRect(0, 0, w, h);
    const cap = heavy ? 600 : 240;
    if (raining && parts.length < cap) {
      const n = (w < 520 ? 2 : 4) * (heavy ? 3 : 1);
      for (let i = 0; i < n; i++) if (Math.random() < 0.65) parts.push(piece(rnd(-20, w + 20), -24, 'rain'));
    }
    for (const p of parts) {
      p.vy = Math.min(p.vy + p.g * dt, p.max);
      p.vx *= p.drag;
      p.sway += p.vs * dt;
      p.flip += p.vf * dt;
      p.rot += p.vr * dt;
      p.x += (p.vx + Math.sin(p.sway) * 0.9) * dt;
      p.y += p.vy * dt;
      draw(p);
    }
    parts = parts.filter((p) => p.y < h + 40);
    if (raining || parts.length) raf = requestAnimationFrame(frame);
    else {
      raf = 0;
      last = 0;
      ctx.clearRect(0, 0, w, h);
    }
  }
  const start = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  function burst(n = 140) {
    for (let i = 0; i < n; i++) parts.push(piece(w / 2 + rnd(-w * 0.2, w * 0.2), h * 0.42, 'burst'));
    start();
  }

  function firework() {
    const x = rnd(w * 0.12, w * 0.88);
    const y = rnd(h * 0.12, h * 0.55);
    for (let i = 0; i < 80; i++) parts.push(piece(x, y, 'firework'));
    start();
  }

  function stopParty() {
    clearTimeout(fireworks);
    fireworks = 0;
    heavy = false;
  }

  return {
    burst,
    rain() {
      if (raining) return;
      if (reduce.matches) return burst(40);
      raining = true;
      burst(90);
    },
    /** Blackout: fireworks all over the screen and a downpour for `ms`, then normal rain. */
    party(ms = 5000) {
      if (reduce.matches) return burst(60);
      stopParty();
      raining = true;
      heavy = true;
      burst(220);
      const end = performance.now() + ms;
      const next = () => {
        firework();
        if (Math.random() < 0.5) firework();
        fireworks = performance.now() < end ? setTimeout(next, rnd(220, 420)) : (heavy = false, 0);
      };
      next();
    },
    // Pieces already in the air drop quickly instead of drifting down for seconds.
    stop() {
      stopParty();
      if (!raining) return;
      raining = false;
      for (const p of parts) {
        p.g = 0.4;
        p.max = 14;
      }
    },
    get raining() {
      return raining;
    },
  };
}
