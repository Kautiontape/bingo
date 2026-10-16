// The ✦ menu. Entries are { label, hint, onSelect, confirm?: { label, when() }, feature? },
// 'sep' for a divider, or { href, label } for a plain link at the bottom.
// An entry with confirm needs a second tap within 3 seconds when confirm.when() is true.

export function createMenu(button, panel) {
  let entries = [];

  function place() {
    const r = button.getBoundingClientRect();
    panel.style.top = `${Math.round(r.bottom + 10)}px`;
    panel.style.right = `${Math.max(16, Math.round(innerWidth - r.right))}px`;
  }

  function render() {
    panel.textContent = '';
    for (const e of entries) {
      if (e === 'sep') {
        panel.append(document.createElement('hr'));
        continue;
      }
      const el = document.createElement(e.href ? 'a' : 'button');
      el.setAttribute('role', 'menuitem');
      if (e.href) {
        el.href = e.href;
        el.className = 'menu-foot';
        el.textContent = e.label;
        panel.append(el);
        continue;
      }
      el.type = 'button';
      if (e.feature) el.className = 'feature';
      const label = document.createElement('span');
      label.textContent = e.label;
      el.append(label);
      if (e.hint) {
        const hint = document.createElement('small');
        hint.textContent = e.hint;
        el.append(hint);
      }
      el.addEventListener('click', () => {
        if (e.confirm && e.confirm.when() && !el.dataset.armed) {
          el.dataset.armed = '1';
          label.textContent = e.confirm.label;
          el._t = setTimeout(() => {
            delete el.dataset.armed;
            label.textContent = e.label;
          }, 3000);
          return;
        }
        clearTimeout(el._t);
        close(false);
        e.onSelect();
      });
      panel.append(el);
    }
  }

  function open() {
    render();
    panel.hidden = false;
    place();
    button.setAttribute('aria-expanded', 'true');
    panel.querySelector('button, a')?.focus();
  }

  function close(focus = true) {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  }

  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) close(false);
  });
  panel.addEventListener('keydown', (e) => {
    const items = [...panel.querySelectorAll('button, a')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  });
  addEventListener('resize', () => !panel.hidden && place());
  addEventListener('scroll', () => !panel.hidden && place(), { passive: true });

  return {
    // Takes effect the next time the menu opens, so a live update can't reset an armed entry.
    set(list) {
      entries = list;
    },
    close,
  };
}
