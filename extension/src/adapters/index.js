// @ts-check
/**
 * @module adapters
 *
 * One declarative adapter per chat platform. The observer and event capture
 * are generic; everything platform-specific is data here, so keeping up with
 * a provider's DOM change means editing a selector string, not logic.
 *
 * Selector lists (comma-separated) are tried together via querySelectorAll;
 * order them most-specific first. `aria-label` fallbacks survive class-name
 * churn better than test ids, but verify each on the live UI. If a platform
 * stops matching, the content script logs a single warning (see
 * content/index.js) rather than failing silently.
 *
 * @typedef {object} Adapter
 * @property {string} id                                 platform key, lowercase
 * @property {RegExp} host
 * @property {string} userMessage                        selector for a user turn container
 * @property {string} assistantMessage                   selector for an assistant turn container
 * @property {string} [copyButton]
 * @property {string} [regenerateButton]
 * @property {string} [stopButton]
 * @property {string} [editButton]
 * @property {string} [modelLabel]                       element whose text names the active model
 * @property {(url: URL) => string|null} conversationId
 * @property {(url: URL) => boolean} inProject           projects / custom GPTs / gems — reusable context
 */

/** @type {Adapter[]} */
export const ADAPTERS = [
  {
    id: 'chatgpt',
    host: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/,
    userMessage: '[data-message-author-role="user"]',
    assistantMessage: '[data-message-author-role="assistant"]',
    copyButton: '[data-testid="copy-turn-action-button"], button[aria-label="Copy" i]',
    regenerateButton: 'button[aria-label*="regenerate" i], [data-testid*="regenerate"]',
    stopButton: '[data-testid="stop-button"], button[aria-label*="stop" i]',
    editButton: 'button[aria-label*="edit" i]',
    modelLabel: '[data-testid="model-switcher-dropdown-button"]',
    conversationId: (u) => /\/c\/([\w-]+)/.exec(u.pathname)?.[1] ?? null,
    inProject: (u) => u.pathname.startsWith('/g/'),
  },
  {
    id: 'claude',
    host: /(^|\.)claude\.ai$/,
    userMessage: '[data-testid="user-message"]',
    assistantMessage: '[data-testid="assistant-message"], .font-claude-response, .font-claude-message',
    copyButton: 'button[data-testid="action-bar-copy"], button[aria-label="Copy" i]',
    regenerateButton: 'button[data-testid="action-bar-retry"], button[aria-label*="retry" i]',
    stopButton: 'button[aria-label*="stop" i]',
    editButton: 'button[aria-label*="edit" i]',
    modelLabel: '[data-testid="model-selector-dropdown"]',
    conversationId: (u) => /\/chat\/([\w-]+)/.exec(u.pathname)?.[1] ?? null,
    inProject: (u) => u.pathname.startsWith('/project/'),
  },
  {
    id: 'gemini',
    host: /(^|\.)gemini\.google\.com$/,
    userMessage: 'user-query',
    assistantMessage: 'model-response',
    copyButton: 'button[data-test-id="copy-button"], button[aria-label*="copy" i]',
    regenerateButton: 'button[aria-label*="regenerate" i], button[aria-label*="redo" i]',
    stopButton: 'button[aria-label*="stop" i]',
    editButton: 'button[aria-label*="edit" i]',
    modelLabel: '[data-test-id="bard-mode-menu-button"], .gds-mode-switch-button',
    conversationId: (u) => /\/app\/([\w]+)/.exec(u.pathname)?.[1] ?? null,
    inProject: (u) => u.pathname.startsWith('/gem/'),
  },
  {
    id: 'copilot',
    host: /(^|\.)copilot\.microsoft\.com$/,
    userMessage: '[data-content="user-message"]',
    assistantMessage: '[data-content="ai-message"]',
    copyButton: 'button[aria-label*="copy" i]',
    regenerateButton: 'button[aria-label*="regenerate" i]',
    stopButton: 'button[aria-label*="stop" i]',
    editButton: 'button[aria-label*="edit" i]',
    conversationId: (u) => /\/chats\/([\w-]+)/.exec(u.pathname)?.[1] ?? null,
    inProject: () => false,
  },
];

/**
 * @param {string} hostname
 * @returns {Adapter|null}
 */
export function adapterFor(hostname) {
  return ADAPTERS.find((a) => a.host.test(hostname)) ?? null;
}

const HEAVY = /\bopus\b|\bpro\b|\bultra\b|thinking|extended|reason|deep research|\bo[13]\b/i;
const LIGHT = /haiku|mini|nano|flash|instant|\bfast\b|\blite\b/i;

/**
 * Coarse capability tier from a model selector's label. Unknown labels are
 * 'unknown' so they never count as a mismatch.
 * @param {string|null|undefined} label
 * @returns {import('@tokenscore/core/features').ModelTier}
 */
export function modelTier(label) {
  if (!label) return 'unknown';
  if (HEAVY.test(label)) return 'heavy';
  if (LIGHT.test(label)) return 'light';
  return 'standard';
}
