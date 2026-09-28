// @ts-check
/**
 * @module content/index
 *
 * Content script entry. Runs on supported chat hosts, does nothing until the
 * user has enabled tracking in the popup, and stops cleanly if they disable
 * it later. Wires observer → tracker → background.
 */
import { adapterFor } from '../adapters/index.js';
import { MSG, send } from '../lib/messages.js';
import { getSettings } from '../lib/storage.js';
import { observeConversation } from './observer.js';
import { ConversationTracker } from './tracker.js';
import { captureEvents } from './events.js';
import { showNudge } from './nudge.js';

const adapter = adapterFor(location.hostname);

if (adapter) {
  /** @type {import('../lib/storage.js').Settings} */ let settings;
  /** @type {ConversationTracker|null} */ let tracker = null;
  /** @type {Array<() => void>} */ let stops = [];

  function start() {
    tracker = new ConversationTracker(adapter, (features) => {
      send(MSG.SESSION_UPSERT, { features }).catch(() => {});
      if (settings.nudges && !tracker?.nudged && features.contextTokens >= settings.nudgeThreshold) {
        tracker.nudged = true;
        showNudge(features.contextTokens);
      }
    });
    stops = [
      observeConversation(adapter, { onScan: (els, dirty) => tracker?.sync(els, dirty), onNavigate: (u) => tracker?.navigate(u) }),
      captureEvents(adapter, tracker),
    ];
    // One-time diagnostic: a conversation URL with no recognised messages means a selector drifted.
    setTimeout(() => {
      if (tracker?.rawId && tracker.stats.length === 0) {
        console.warn(`[TokenScore] No messages recognised on ${adapter.id}. Selectors in src/adapters/index.js may need updating.`);
      }
    }, 15_000);
  }

  function stop() {
    for (const s of stops) s();
    stops = [];
    tracker = null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === MSG.RECEIPT_GET) reply(tracker?.features() ?? null);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const was = settings?.enabled;
    settings = changes.settings.newValue;
    if (settings.enabled && !was) start();
    else if (!settings.enabled && was) stop();
  });

  getSettings().then((s) => {
    settings = s;
    if (s.enabled) start();
  });
}
