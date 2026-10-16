// The players strip under a shared board.

function progress(p, mode) {
  if (mode === 'shared') return { text: `${p.marked} marked`, cls: '' };
  if (p.blackout) return { text: 'BLACKOUT', cls: 'won' };
  if (p.lines) return { text: p.lines > 1 ? `BINGO ×${p.lines}` : 'BINGO', cls: 'won' };
  if (p.away === 1) return { text: '1 away', cls: 'hot' };
  return { text: `${p.found} spotted`, cls: '' };
}

export function renderPlayers(section, list, { board, meId, online }) {
  if (!board) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const players = board.players.slice().sort((a, b) => {
    if (a.id === meId) return -1;
    if (b.id === meId) return 1;
    if (board.mode === 'shared') return b.marked - a.marked;
    return (b.lines ?? 0) - (a.lines ?? 0) || (a.away ?? 9) - (b.away ?? 9) || (b.found ?? 0) - (a.found ?? 0);
  });
  list.textContent = '';
  for (const p of players) {
    const here = online.has(p.id);
    const li = document.createElement('li');
    const prog = progress(p, board.mode);
    li.className = [here ? '' : 'offline', prog.cls === 'won' ? 'won' : ''].join(' ').trim();
    const dot = document.createElement('span');
    dot.className = here ? 'dot live' : 'dot';
    dot.style.setProperty('--c', p.color);
    dot.title = here ? 'Here now' : 'Not here right now';
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = p.name;
    if (p.id === meId) {
      const you = document.createElement('span');
      you.className = 'you';
      you.textContent = ' (you)';
      name.append(you);
    }
    const pr = document.createElement('span');
    pr.className = `prog ${prog.cls}`.trim();
    pr.textContent = prog.text;
    li.append(dot, name, pr);
    list.append(li);
  }
}
