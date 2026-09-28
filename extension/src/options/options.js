// @ts-check
/**
 * @module options/options
 * Settings page: consent toggle, nudge preference, server URL, and account
 * (register or paste key). Saves to chrome.storage.local via lib/storage.
 */
import { MSG, send } from '../lib/messages.js';
import { getSettings, updateSettings, setSessions } from '../lib/storage.js';

const $ = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** @param {string} text @param {boolean} [isError] */
function status(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.className = isError ? 'error' : 'muted';
}

/** @param {import('../lib/storage.js').Settings} s */
function render(s) {
  $('enabled').checked = s.enabled;
  $('nudges').checked = s.nudges;
  $('nudgeThreshold').value = String(s.nudgeThreshold);
  $('serverUrl').value = s.serverUrl;
  $('displayName').value = s.displayName;
  const signedIn = Boolean(s.apiKey);
  $('signed-in').classList.toggle('hidden', !signedIn);
  $('signed-out').classList.toggle('hidden', signedIn);
  $('who').textContent = s.displayName ? `${s.displayName}` : 'unknown';
  $('apiKey').textContent = '••••••••••••';
  $('reveal').textContent = 'Reveal';
}

async function save() {
  const s = await updateSettings({
    enabled: $('enabled').checked,
    nudges: $('nudges').checked,
    nudgeThreshold: Math.max(5000, Number($('nudgeThreshold').value) || 30000),
    serverUrl: $('serverUrl').value.trim() || 'http://localhost:8787',
  });
  render(s);
  status('Saved');
}

async function main() {
  render(await getSettings());

  $('save').addEventListener('click', save);

  $('register').addEventListener('click', async () => {
    await save();
    const displayName = $('displayName').value.trim();
    if (displayName.length < 2) return status('Enter a display name first', true);
    status('Creating account…');
    const res = await send(MSG.REGISTER, { displayName, role: $('role').value });
    if (res?.error) return status(res.error, true);
    render(await getSettings());
    status('Account created');
  });

  $('useKey').addEventListener('click', async () => {
    const apiKey = $('apiKeyInput').value.trim();
    if (!apiKey.startsWith('ts_')) return status('Keys start with ts_', true);
    await save();
    render(await updateSettings({ apiKey }));
    status('Key saved');
  });

  $('reveal').addEventListener('click', async () => {
    const s = await getSettings();
    const hidden = $('apiKey').textContent?.startsWith('•');
    $('apiKey').textContent = hidden ? s.apiKey : '••••••••••••';
    $('reveal').textContent = hidden ? 'Hide' : 'Reveal';
  });

  $('signout').addEventListener('click', async () => {
    render(await updateSettings({ apiKey: '', userId: '' }));
    status('Disconnected');
  });

  $('syncNow').addEventListener('click', async () => {
    status('Syncing…');
    const res = await send(MSG.SYNC_NOW);
    status(res?.error ? `Sync failed: ${res.error}` : 'Synced', Boolean(res?.error));
  });

  $('clear').addEventListener('click', async () => {
    await setSessions({});
    await chrome.storage.local.remove('score');
    status('Local sessions and cached score cleared');
  });
}

main();
