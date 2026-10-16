/** Close buttons ([data-close]) and a click on the backdrop close the dialog. */
export function wireClose(dlg) {
  // Both ends of the click must be on the backdrop, so a text selection dragged out of a
  // field doesn't close the form.
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === dlg;
  });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || (e.target === dlg && downOnBackdrop)) dlg.close();
  });
}
