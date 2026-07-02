/**
 * uidotsh-patch.js
 *
 * Keeps the ui.sh picker visible above shadcn-svelte sheets/dialogs (built on
 * bits-ui). Stops pointer, click, and focus events that originate inside the
 * picker from bubbling up to the document, which prevents bits-ui's
 * DismissibleLayer from treating those events as "interact outside" and
 * closing the sheet/dialog.
 *
 * Without this patch, clicking the picker while a sheet is open would dismiss
 * the sheet AND cause the picker to vanish (because the content it previews
 * lives inside the sheet).
 */

(function () {

  const PICKER_TAG = 'uidotsh-picker';
  const Z_ABOVE = '9999';

  function stopPropagation(e) {
    e.stopPropagation();
  }

  const STOP_EVENTS = ['pointerdown', 'mousedown', 'click', 'touchstart', 'focusin'];

  function attachPatch(picker) {
    picker.style.zIndex = Z_ABOVE;
    picker.style.pointerEvents = 'auto';

    // Move picker to end of body so it's above sheet overlays in DOM order
    if (picker.parentElement !== document.body) {
      document.body.appendChild(picker);
    }

    for (const event of STOP_EVENTS) {
      picker.addEventListener(event, stopPropagation, false);
    }

    // Keep z-index and pointer-events pinned if uidotsh resets them
    new MutationObserver(() => {
      if (picker.style.zIndex !== Z_ABOVE) {
        picker.style.zIndex = Z_ABOVE;
      }
      if (picker.style.pointerEvents !== 'auto') {
        picker.style.pointerEvents = 'auto';
      }
    }).observe(picker, { attributes: true, attributeFilter: ['style'] });
  }

  function init() {
    const existing = document.querySelector(PICKER_TAG);
    if (existing) { attachPatch(existing); return; }

    new MutationObserver((_, mo) => {
      const picker = document.querySelector(PICKER_TAG);
      if (picker) { mo.disconnect(); attachPatch(picker); }
    }).observe(document.documentElement, { subtree: true, childList: true });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init, { once: true })
    : init();

})();