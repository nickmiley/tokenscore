// @ts-check
/**
 * @module content/events
 *
 * Captures the UI interactions that feature extraction cannot see in the DOM:
 * copy (button or keyboard), regenerate, stop and edit. One capture-phase
 * click listener and one copy listener; nothing runs per keystroke.
 * Clipboard contents are never read — selection text is measured for its
 * token count and discarded.
 */

/** @typedef {import('../adapters/index.js').Adapter} Adapter */
/** @typedef {import('./tracker.js').ConversationTracker} ConversationTracker */

/** Selections shorter than this are cursor noise, not reuse. */
const MIN_COPY_CHARS = 20;

/**
 * @param {Adapter} adapter
 * @param {ConversationTracker} tracker
 * @returns {() => void} stop
 */
export function captureEvents(adapter, tracker) {
  /** @param {MouseEvent} e */
  function onClick(e) {
    const t = e.target instanceof Element ? e.target : /** @type {Node} */ (e.target)?.parentElement;
    if (!t) return;
    if (adapter.copyButton && t.closest(adapter.copyButton)) tracker.recordCopy(tracker.assistantMessageFor(t));
    else if (adapter.regenerateButton && t.closest(adapter.regenerateButton)) tracker.recordEvent('regenerations');
    else if (adapter.stopButton && t.closest(adapter.stopButton)) tracker.recordEvent('stops');
    else if (adapter.editButton && t.closest(adapter.editButton)) tracker.recordEvent('edits');
  }

  function onCopy() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    if (text.length < MIN_COPY_CHARS) return;
    const node = sel.anchorNode;
    const el = node?.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (node) : node?.parentElement;
    const msg = el?.closest(adapter.assistantMessage) ?? null;
    if (msg) tracker.recordCopy(msg, text);
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('copy', onCopy, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('copy', onCopy, true);
  };
}
