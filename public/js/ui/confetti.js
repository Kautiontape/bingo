// Confetti on a full-screen canvas. rain() keeps it falling until stop(); with reduced
// motion it becomes one small burst.

const COLORS = ['#D3166F', '#FF4FA3', '#5A1FC4', '#A57CFF', '#F5A524', '#FFC453', '#14B8A6', '#3B82F6'];
const GLYPHS = ['🎉', '👀', '⭐', '✨', '🥳'];
const MAX = 240;

export function createConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let parts = [];
  let raining = false;
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
  function piece(x, y, burst) {
    const glyph = Math.random() < 0.08;
    return {
      x, y,
      vx: burst ? rnd(-7, 7) : rnd(-0.6, 0.6),
      vy: burst ? rnd(-13, -5) : rnd(1.2, 2.6),
      g: burst ? 0.32 : 0.035,
      max: burst ? 8 : 3.6,
      rot: rnd(0, Math.PI * 2),
      vr: rnd(-0.18, 0.18),
      flip: rnd(0, Math.PI * 2),
      vf: rnd(0.05, 0.14),
      sway: rnd(0, Math.PI * 2),
      vs: rnd(0.015, 0.045),
      size: glyph ? rnd(18, 26) : rnd(7, 12),
      color: COLORS[(Math.random() * COLORS.length) | 0],
      kind: glyph ? 'glyph' : Math.random() < 0.28 ? 'dot' : 'paper',
      glyph: GLYPHS[(Math.random() * GLYPHS.length) | 0],
    };
  }

  function draw(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.kind === 'glyph') {
      ctx.font = `${p.size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.rotate(Math.sin(p.rot) * 0.4);
      ctx.fillText(p.glyph, 0, 0);
    } else {
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.kind === 'dot') {
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
    if (raining && parts.length < MAX) {
      const n = w < 520 ? 2 : 4;
      for (let i = 0; i < n; i++) if (Math.random() < 0.65) parts.push(piece(rnd(-20, w + 20), -24, false));
    }
    for (const p of parts) {
      p.vy = Math.min(p.vy + p.g * dt, p.max);
      p.vx *= 0.985;
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
    for (let i = 0; i < n; i++) parts.push(piece(w / 2 + rnd(-w * 0.2, w * 0.2), h * 0.42, true));
    start();
  }

  return {
    burst,
    rain() {
      if (raining) return;
      if (reduce.matches) return burst(40);
      raining = true;
      burst(90);
    },
    // Pieces already in the air drop quickly instead of drifting down for seconds.
    stop() {
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
