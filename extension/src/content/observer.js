// @ts-check
/**
 * @module content/observer
 *
 * Watches the page for message changes without doing work in the hot path.
 *
 * The MutationObserver callback only marks which message elements were
 * touched (`closest()` on each mutation target) and schedules a scan; the scan
 * itself runs in an idle callback (bounded by a 500 ms timeout so streaming
 * replies still settle promptly). Each scan hands the tracker the ordered
 * list of message elements plus the dirty set, so unchanged messages are
 * never re-read. SPA navigation is detected by comparing `location.href` on
 * each scan — cheaper and more reliable than hooking history.
 */

/** @typedef {import('../adapters/index.js').Adapter} Adapter */

const idle = /** @type {(cb: () => void) => void} */ (
  typeof requestIdleCallback === 'function' ? (cb) => requestIdleCallback(cb, { timeout: 500 }) : (cb) => setTimeout(cb, 200)
);

/**
 * @param {Adapter} adapter
 * @param {{ onScan: (elements: Element[], dirty: Set<Element>) => void, onNavigate: (url: URL) => void }} handlers
 * @returns {() => void} stop
 */
export function observeConversation(adapter, handlers) {
  const selector = `${adapter.userMessage}, ${adapter.assistantMessage}`;
  /** @type {Set<Element>} */ let dirty = new Set();
  let scheduled = false;
  let href = location.href;

  function scan() {
    scheduled = false;
    if (location.href !== href) {
      href = location.href;
      handlers.onNavigate(new URL(href));
    }
    const touched = dirty;
    dirty = new Set();
    handlers.onScan(Array.from(document.querySelectorAll(selector)), touched);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    idle(scan);
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const node = r.target.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (r.target) : r.target.parentElement;
      const msg = node?.closest(selector);
      if (msg) dirty.add(msg);
    }
    schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };
  document.addEventListener('visibilitychange', onVisible);
  schedule();

  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', onVisible);
  };
}
