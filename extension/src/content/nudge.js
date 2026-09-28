// @ts-check
/**
 * @module content/nudge
 *
 * A small in-page notice shown once per conversation when the context grows
 * past the user's threshold. Rendered in a shadow root so host-page CSS
 * cannot leak in or out. Coaching that prevents waste is worth more than a
 * score that reports it afterwards.
 */

const STYLE = `
  :host { all: initial; }
  .n {
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
    max-width: 320px; padding: 14px 16px;
    font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; color: #16211e;
    background: #f3f4f2; border: 1px solid #c9cfcb; border-left: 4px solid #2f5d50;
  }
  .n strong { font-weight: 600; font-variant-numeric: tabular-nums; }
  .n button {
    margin-top: 10px; padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer;
    color: #f3f4f2; background: #2f5d50; border: 0;
  }
  .n button:focus-visible { outline: 2px solid #16211e; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    .n { color: #e8ece9; background: #1c2320; border-color: #3a4440; border-left-color: #7fb8a4; }
    .n button { background: #7fb8a4; color: #141a18; }
    .n button:focus-visible { outline-color: #e8ece9; }
  }
`;

/**
 * @param {number} contextTokens
 * @returns {() => void} remove
 */
export function showNudge(contextTokens) {
  const host = document.createElement('div');
  host.setAttribute('data-tokenscore', 'nudge');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const box = document.createElement('div');
  box.className = 'n';
  box.setAttribute('role', 'status');
  const k = Math.round(contextTokens / 1000);
  box.innerHTML = `This thread is about <strong>${k}k tokens</strong> of context, and every new message resends all of it. Unrelated questions are cheaper and faster in a new chat.`;
  const btn = document.createElement('button');
  btn.textContent = 'Got it';
  btn.addEventListener('click', () => host.remove());
  box.append(btn);
  root.append(style, box);
  document.body.append(host);
  return () => host.remove();
}
