// The share popup. States:
//   offer   private board: pick a mode, then onGetLink(mode) creates the shared board
//   loading
//   ready   link, Copy, the phone's share sheet, QR code
//   error   message and Retry

import { toast } from './toast.js';
import { wireClose } from './dialog.js';

const MODE_NOTE = {
  cards: 'Everyone who opens it gets their own card from this list.',
  shared: 'Everyone who opens it marks this same card with you.',
};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.filter((k) => k != null));
  return e;
}

export function createShare() {
  const dlg = document.getElementById('shareDlg');
  const body = document.getElementById('shareBody');
  const head = document.getElementById('shareHead');
  wireClose(dlg);

  function show(...nodes) {
    body.textContent = '';
    body.append(...nodes.filter(Boolean));
    if (!dlg.open) dlg.showModal();
  }

  function offer({ mode = 'cards', onGetLink }) {
    head.textContent = 'Share this board';
    let picked = mode;
    const radio = (value, title, text) => {
      const id = `share-${value}`;
      return [
        el('input', { type: 'radio', name: 'shareMode', id, value, checked: value === picked, onchange: () => (picked = value) }),
        el('label', { for: id }, el('strong', {}, title), el('span', {}, text)),
      ];
    };
    show(
      el('p', { class: 'share-note' }, 'Get a link and a QR code so friends can join in.'),
      el('div', { class: 'modes' },
        ...radio('cards', 'Everyone gets a card', 'Same list, a different card for each person.'),
        ...radio('shared', 'One shared card', 'Everyone marks this card together.'),
      ),
      el('div', { class: 'share-actions' },
        el('button', { class: 'btn primary glow', type: 'button', onclick: () => onGetLink(picked) }, 'Get link'),
      ),
    );
  }

  function loading() {
    head.textContent = 'Making your link…';
    show(el('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' }));
  }

  function ready({ url, qr, mode, title }) {
    head.textContent = 'Invite people';
    const input = el('input', { value: url, readonly: true, 'aria-label': 'Board link', onfocus: (e) => e.target.select() });
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      toast('Link copied');
    };
    const canShare = typeof navigator.share === 'function';
    show(
      el('p', { class: 'share-note' }, MODE_NOTE[mode] ?? MODE_NOTE.cards),
      el('div', { class: 'share-link' }, input, el('button', { class: 'btn primary', type: 'button', onclick: copy }, 'Copy')),
      el('div', { class: 'qr' }, el('img', { src: qr, alt: 'QR code for the board link', width: 230, height: 230 })),
      el('p', { class: 'share-note' }, 'Point a phone camera at the code to join.'),
      canShare
        ? el('div', { class: 'share-actions' },
            el('button', {
              class: 'btn', type: 'button',
              onclick: () => navigator.share({ title, text: `Play ${title} with me`, url }).catch(() => {}),
            }, 'Share…'))
        : null,
    );
  }

  function error({ message, retry }) {
    head.textContent = 'Couldn’t make a link';
    show(
      el('p', { class: 'share-note' }, message),
      el('p', { class: 'share-note' }, 'Your board still works here. Try again when you’re back online.'),
      el('div', { class: 'share-actions' }, el('button', { class: 'btn primary', type: 'button', onclick: retry }, 'Retry')),
    );
  }

  return { offer, loading, ready, error, close: () => dlg.close(), get open() { return dlg.open; } };
}
