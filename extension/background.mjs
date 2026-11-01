import './quick-background.mjs';
import './lifecycle.mjs';
chrome.action.onClicked.addListener(async tab => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') + (Number.isInteger(tab.id) ? '?tab=' + tab.id : '') });
});
// Only extension-initiated cover requests receive the site Referer.
// Stream fetches run in the source tab, keeping Bilibili's normal fetch origin.
async function installRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1], addRules: [{
    id: 1, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: 'https://www.bilibili.com/' }] },
    condition: { initiatorDomains: [chrome.runtime.id], requestDomains: ['hdslb.com'], resourceTypes: ['other', 'image', 'xmlhttprequest'] }
  }] });
}
chrome.runtime.onInstalled.addListener(() => { installRules().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { installRules().catch(console.error); });
