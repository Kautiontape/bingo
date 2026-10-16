export function toast(text, { big = false, ms = 3800 } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = big ? 'toast big' : 'toast';
  el.textContent = text;
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('bye');
    setTimeout(() => el.remove(), 350);
  }, ms);
}
