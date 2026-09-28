// @ts-check
/**
 * @module content/tracker
 *
 * Holds the state of the conversation currently on screen and turns it into
 * a {@link ConversationFeatures} vector once it settles.
 *
 * Per-element cache: a WeakMap from message element to `{ len, hash, stats }`.
 * A message is only re-derived when its text length or hash changes, so a
 * streaming reply costs one derivation per scan and a finished thread costs
 * nothing. Text is hashed for change detection and then dropped.
 */
import { countTokens } from '@tokenscore/core/tokenizer';
import { hash32 } from '@tokenscore/core/text';
import { deriveMessage, aggregateConversation, emptyEvents } from '@tokenscore/core/features';
import { modelTier } from '../adapters/index.js';

/** @typedef {import('../adapters/index.js').Adapter} Adapter */
/** @typedef {import('@tokenscore/core/features').MessageStats} MessageStats */
/** @typedef {import('@tokenscore/core/features').ConversationFeatures} ConversationFeatures */

/** Quiet period after the last text change before features are emitted. */
const SETTLE_MS = 1500;

export class ConversationTracker {
  /**
   * @param {Adapter} adapter
   * @param {(features: ConversationFeatures) => void} onSettled
   */
  constructor(adapter, onSettled) {
    this.adapter = adapter;
    this.onSettled = onSettled;
    /** @type {WeakMap<Element, { len: number, hash: number, stats: MessageStats }>} */
    this.cache = new WeakMap();
    /** @type {Element[]} */ this.elements = [];
    /** @type {MessageStats[]} */ this.stats = [];
    this.events = emptyEvents();
    /** @type {string|null} */ this.rawId = adapter.conversationId(new URL(location.href));
    this.inProject = adapter.inProject(new URL(location.href));
    this.startedAt = Date.now();
    /** @type {ReturnType<typeof setTimeout>|undefined} */ this.settleTimer = undefined;
    this.nudged = false;
  }

  /** Opaque, platform-scoped key; the raw URL id never leaves the page. */
  get conversationId() {
    return this.rawId ? `${this.adapter.id}:${hash32(this.rawId).toString(16)}` : null;
  }

  /**
   * Called on every SPA navigation. A new chat gets its URL id after the first
   * reply, so a null → id transition adopts the id and keeps counters; any
   * other change is a different conversation.
   * @param {URL} url
   */
  navigate(url) {
    const id = this.adapter.conversationId(url);
    const inProject = this.adapter.inProject(url);
    if (id === this.rawId) return;
    if (this.rawId === null && this.stats.length) {
      this.rawId = id;
      this.inProject = inProject;
      this.schedule();
      return;
    }
    this.rawId = id;
    this.inProject = inProject;
    this.events = emptyEvents();
    this.elements = [];
    this.stats = [];
    this.startedAt = Date.now();
    this.nudged = false;
  }

  /**
   * Reconcile with the DOM. Elements not in `dirty` and already cached are
   * reused as-is.
   * @param {Element[]} elements  ordered message containers
   * @param {Set<Element>} dirty  elements touched since the last scan
   */
  sync(elements, dirty) {
    let changed = elements.length !== this.elements.length;
    const next = new Array(elements.length);
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      let rec = this.cache.get(el);
      if (!rec || dirty.has(el)) {
        const text = el.textContent ?? '';
        const hash = hash32(text);
        if (!rec || rec.len !== text.length || rec.hash !== hash) {
          const role = el.matches(this.adapter.userMessage) ? 'user' : 'assistant';
          rec = { len: text.length, hash, stats: deriveMessage(role, text) };
          this.cache.set(el, rec);
          changed = true;
        }
      } else if (this.elements[i] !== el) {
        changed = true;
      }
      next[i] = rec.stats;
    }
    this.elements = elements;
    this.stats = next;
    if (changed) this.schedule();
  }

  /** Emit once the conversation has been quiet for {@link SETTLE_MS}. */
  schedule() {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      const f = this.features();
      if (f) this.onSettled(f);
    }, SETTLE_MS);
  }

  /** @returns {ConversationFeatures|null} null until the conversation has a URL id and a user turn */
  features() {
    const conversationId = this.conversationId;
    if (!conversationId || !this.stats.length) return null;
    const label = this.adapter.modelLabel ? document.querySelector(this.adapter.modelLabel)?.textContent : null;
    return aggregateConversation(this.stats, this.events, {
      conversationId,
      platform: this.adapter.id,
      modelTier: modelTier(label),
      inProject: this.inProject,
      startedAt: this.startedAt,
    });
  }

  /**
   * The assistant message a UI control belongs to. Action bars usually sit
   * outside the message container, so fall back to the nearest preceding
   * assistant message in document order. Only runs on clicks.
   * @param {Element} from
   * @returns {Element|null}
   */
  assistantMessageFor(from) {
    const inside = from.closest(this.adapter.assistantMessage);
    if (inside) return inside;
    let best = null;
    for (const el of this.elements) {
      if (!el.matches(this.adapter.assistantMessage)) continue;
      if (el.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING) best = el;
      else break;
    }
    return best;
  }

  /**
   * @param {Element|null} messageEl
   * @param {string} [selectedText]  set for keyboard/selection copies; omitted for copy-button copies
   */
  recordCopy(messageEl, selectedText) {
    if (!messageEl) return;
    const stats = this.cache.get(messageEl)?.stats;
    if (!stats) return;
    const tokens = selectedText ? Math.min(stats.tokens, countTokens(selectedText)) : stats.tokens;
    this.events.copyEvents++;
    this.events.copiedTokens += tokens;
    this.schedule();
  }

  /** @param {'regenerations'|'stops'|'edits'} kind */
  recordEvent(kind) {
    this.events[kind]++;
    this.schedule();
  }
}
