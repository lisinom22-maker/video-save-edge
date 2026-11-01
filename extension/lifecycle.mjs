// Manifest content scripts apply to new documents. Existing tabs need a new
// connection after an extension update/reload invalidates their old context.
const pending = new Map();
export function ensureQuickContent(tabId) {
  if (!Number.isInteger(tabId)) return Promise.resolve();
  if (pending.has(tabId)) return pending.get(tabId);
  const job = (async () => {
    const alive = await chrome.tabs.sendMessage(tabId, { type: 'vs-quick-ping' }, { frameId: 0 }).catch(() => null);
    if (alive?.ready && alive.version === chrome.runtime.getManifest().version) return;
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['compat.js', 'quick-rules.js', 'quick-content.js'] });
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: ['quick.css'] });
  })().finally(() => pending.delete(tabId));
  pending.set(tabId, job);
  return job;
}
export async function restoreOpenPages() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.allSettled(tabs.map(tab => ensureQuickContent(tab.id)));
}
const restore = () => restoreOpenPages().catch(() => {});
chrome.runtime.onInstalled.addListener(restore);
chrome.runtime.onStartup.addListener(restore);
chrome.tabs.onActivated.addListener(({ tabId }) => ensureQuickContent(tabId).catch(() => {}));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') ensureQuickContent(tabId).catch(() => {});
});
restore();
