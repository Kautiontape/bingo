// The create / edit board form. onSubmit(values, kind) may throw; its message is shown in
// the form and the dialog stays open.

import { DEFAULT_FREE_TEXT, LIMITS, cleanItems, hasFree, needed } from '../card.js';
import { PEOPLE_WATCHING } from '../phrases.js';
import { wireClose } from './dialog.js';

export function createForm({ onSubmit }) {
  const $ = (s) => document.querySelector(s);
  const dlg = $('#createDlg');
  const form = $('#createForm');
  const f = {
    head: $('#createHead'), title: $('#fTitle'), items: $('#fItems'), tally: $('#fTally'),
    starter: $('#fStarter'), free: $('#fFree'), freeText: $('#fFreeText'), modeNote: $('#fModeNote'),
    error: $('#fError'), submit: $('#fSubmit'),
  };
  const sizes = () => [...form.querySelectorAll('input[name="size"]')];
  const modes = () => [...form.querySelectorAll('input[name="mode"]')];
  let kind = 'create';
  let busy = false;

  wireClose(dlg);

  function values() {
    const size = Number(sizes().find((r) => r.checked)?.value ?? 5);
    return {
      title: f.title.value.replace(/\s+/g, ' ').trim(),
      items: cleanItems(f.items.value),
      size,
      free: f.free.checked,
      freeText: f.freeText.value.replace(/\s+/g, ' ').trim() || DEFAULT_FREE_TEXT,
      mode: modes().find((r) => r.checked)?.value ?? 'cards',
    };
  }

  function sync() {
    const v = values();
    const odd = v.size % 2 === 1;
    f.free.disabled = !odd;
    f.freeText.disabled = !hasFree(v.size, v.free);
    const need = needed(v.size, v.free);
    f.tally.textContent = `${v.items.length} item${v.items.length === 1 ? '' : 's'} · ${need} per card`;
    f.tally.classList.toggle('short', v.items.length < need);
    f.starter.hidden = v.items.length >= PEOPLE_WATCHING.length;
  }

  /** values: { title, items (array), size, free, freeText, mode }. lockMode: shared boards keep theirs. */
  function open({ kind: k, values: v, lockMode = false }) {
    kind = k;
    f.head.textContent = k === 'create' ? 'Create custom board' : 'Edit board';
    f.submit.textContent = k === 'create' ? 'Create & share' : 'Save';
    f.title.value = v.title ?? '';
    f.items.value = (v.items ?? []).join('\n');
    sizes().forEach((r) => (r.checked = Number(r.value) === (v.size ?? 5)));
    f.free.checked = v.free ?? true;
    f.freeText.value = v.freeText ?? DEFAULT_FREE_TEXT;
    modes().forEach((r) => {
      r.checked = r.value === (v.mode ?? 'cards');
      r.disabled = lockMode;
    });
    f.modeNote.hidden = !lockMode;
    f.error.textContent = '';
    setBusy(false);
    sync();
    dlg.showModal();
    (k === 'create' ? f.title : f.items).focus();
  }

  function setBusy(b) {
    busy = b;
    f.submit.disabled = b;
    f.submit.textContent = b ? 'Saving…' : kind === 'create' ? 'Create & share' : 'Save';
  }

  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  f.starter.addEventListener('click', () => {
    const have = cleanItems(f.items.value);
    f.items.value = cleanItems([...have, ...PEOPLE_WATCHING]).join('\n');
    if (!f.title.value.trim()) f.title.value = 'People Watching Bingo';
    sync();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const v = values();
    const need = needed(v.size, v.free);
    if (v.items.length < need) {
      f.error.textContent = `A ${v.size}×${v.size} card needs ${need} squares. Add ${need - v.items.length} more, or pick a smaller size.`;
      return;
    }
    if (v.items.length > LIMITS.items) {
      f.error.textContent = `That’s more than ${LIMITS.items} squares. Trim a few.`;
      return;
    }
    const long = v.items.find((s) => s.length > LIMITS.item);
    if (long) {
      f.error.textContent = `Squares can be at most ${LIMITS.item} characters: “${long.slice(0, 30)}…”`;
      return;
    }
    if (!v.title) v.title = kind === 'create' ? 'Bingo' : v.title;
    f.error.textContent = '';
    setBusy(true);
    try {
      await onSubmit(v, kind);
      dlg.close();
    } catch (err) {
      f.error.textContent = err.message;
    } finally {
      setBusy(false);
    }
  });

  return { open };
}
