import './quick-rules.js';
import { outputStatus } from './output.mjs';
const rules = globalThis.VideoQuickRules;
const key = id => 'vs-job:' + id;
const finished = new Set();
const jobs = async () => Object.entries(await chrome.storage.session.get(null)).filter(([k]) => k.startsWith('vs-job:')).map(([, value]) => value);
const current = async job => {
  if (finished.has(job.id)) return null;
  const value = (await chrome.storage.session.get(key(job.id)))[key(job.id)];
  return finished.has(job.id) ? null : value;
};
async function persist(job) {
  if (finished.has(job.id)) return false;
  await chrome.storage.session.set({ [key(job.id)]: job });
  if (finished.has(job.id)) { await chrome.storage.session.remove(key(job.id)); return false; }
  return true;
}
async function closeMedia(job) { if (job.mediaTabId) await chrome.tabs.remove(job.mediaTabId).catch(() => {}); }
const destination = job => job.requesterDocumentId ? { documentId: job.requesterDocumentId } : { frameId: job.requesterFrameId || 0 };
async function feedback(job, state, message) { await chrome.tabs.sendMessage(job.sourceTab, { type: 'vs-quick-feedback', state, message, jobId: job.id }, destination(job)).catch(() => {}); }
async function finish(job, state, message, closeTask = false) {
  if (finished.has(job.id)) return;
  finished.add(job.id);
  const latest = (await chrome.storage.session.get(key(job.id)))[key(job.id)];
  const owned = { ...job, ...latest };
  await chrome.storage.session.remove(key(job.id));
  await feedback(owned, state, message);
  await closeMedia(owned);
  if (closeTask && owned.taskTabId) {
    await chrome.tabs.sendMessage(owned.taskTabId, { type: 'vs-task-cancel' }).catch(() => {});
    await chrome.tabs.remove(owned.taskTabId).catch(() => {});
  }
}
function isWebsite(sender) { try { return sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && ['http:', 'https:'].includes(new URL(sender.url).protocol); } catch { return false; } }
async function launchTask(job, target, sourceTab, frameId, token) {
  const query = new URLSearchParams({ tab: String(sourceTab), auto: '1', job: job.id });
  if (target.kind !== 'bilibili' && token) { query.set('frame', String(frameId)); query.set('token', token); }
  if (target.kind === 'page') query.set('discover', '1');
  const status = await outputStatus();
  if (!await current(job)) { await closeMedia(job); return; }
  job.taskTabId = (await chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') + '?' + query, active: !status.allowed })).id;
  if (!await current(job)) { await chrome.tabs.remove(job.taskTabId).catch(() => {}); await closeMedia(job); return; }
  if (!await persist(job)) { await chrome.tabs.remove(job.taskTabId).catch(() => {}); await closeMedia(job); }
}
async function resolvePage(job, target) {
  try {
    // Register ownership before navigation so an immediate cancel cannot leave
    // an untracked detail tab behind.
    job.mediaTabId = (await chrome.tabs.create({ url: 'about:blank', active: false })).id;
    if (!await current(job)) { await chrome.tabs.remove(job.mediaTabId).catch(() => {}); return; }
    if (!await persist(job)) { await closeMedia(job); return; }
    if (!await current(job)) { await chrome.tabs.remove(job.mediaTabId).catch(() => {}); return; }
    await chrome.tabs.update(job.mediaTabId, { url: target.url });
    const deadline = Date.now() + 20000;
    while (true) {
      if (!await current(job)) { await closeMedia(job); return; }
      const tab = await chrome.tabs.get(job.mediaTabId);
      const committedWebPage = /^https?:\/\//.test(tab.url || '');
      // tabs.create can return before the first navigation commits. about:blank
      // here is an initial state, not a redirect away from the requested video.
      if (tab.status === 'complete' && tab.url && tab.url !== 'about:blank' && !committedWebPage) throw new Error('视频链接跳转到了不支持的页面。');
      if (committedWebPage && tab.status === 'complete') break;
      if (Date.now() > deadline) throw new Error('视频详情页加载超时，请稍后重试。');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await launchTask(job, target, job.mediaTabId, 0, null);
  } catch (error) { await finish(job, 'error', error.message); }
  finally { if (finished.has(job.id)) await closeMedia(job); }
}
async function start(message, sender) {
  let frameId = sender.frameId || 0, documentId = sender.documentId;
  if (message.childFrame) {
    const entry = (await chrome.storage.session.get('vs-hover:' + sender.tab.id))['vs-hover:' + sender.tab.id];
    if (!entry?.hovered) throw new Error('请把鼠标放到视频画面或封面链接上。');
    frameId = entry.frameId; documentId = entry.documentId;
  }
  const response = await chrome.tabs.sendMessage(sender.tab.id, { type: 'vs-quick-describe', token: message.token || null }, documentId ? { documentId } : { frameId });
  if (!response?.ok || !response.target) throw new Error(response?.error || '鼠标下的视频已变化，请重新选择。');
  const target = response.target;
  if (target.protected) throw new Error('该视频使用内容保护，无法保存。');
  let media;
  if (target.kind === 'page') media = rules.classifyVideoLink(target.url, target.pageURL, { hasImage: target.hasImage, videoHint: target.videoHint });
  else if (target.kind === 'bilibili' && /^https:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(?:BV[a-zA-Z0-9]{10}|av\d+)\/?(?:[?#]|$)/.test(target.pageURL)) media = target;
  else media = rules.classifyMedia(target.url, target.pageURL, target.mime);
  if (!media || !['page', 'bilibili', 'direct', 'blob'].includes(media.kind)) throw new Error('该条目没有支持的视频地址。');
  const identity = `${sender.tab.id}:${frameId}:${target.token}:${media.url || ''}`;
  const duplicate = (await jobs()).find(j => j.identity === identity);
  if (duplicate) return { ok: true, jobId: duplicate.id, duplicate: true };
  const job = { id: crypto.randomUUID(), sourceTab: sender.tab.id, frameId, documentId, requesterDocumentId: sender.documentId, requesterFrameId: sender.frameId || 0, identity, createdAt: Date.now(), kind: media.kind };
  await chrome.storage.session.set({ [key(job.id)]: job });
  const needsFolder = !(await outputStatus()).allowed;
  if (media.kind === 'page') resolvePage(job, { ...target, ...media });
  else launchTask(job, { ...target, ...media }, sender.tab.id, frameId, target.token).catch(error => finish(job, 'error', error.message));
  return { ok: true, jobId: job.id, needsFolder };
}
chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove('vs-hover:' + tabId).catch(() => {});
  jobs().then(async entries => { for (const job of entries) if (job.taskTabId === tabId || job.mediaTabId === tabId) await finish(job, 'error', '视频解析或下载页面已关闭，任务已中断。'); }).catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string' || !message.type.startsWith('vs-')) return;
  (async () => {
    if (message.type === 'vs-task-finish') {
      const job = (await chrome.storage.session.get(key(message.jobId)))[key(message.jobId)];
      if (!job || job.taskTabId !== sender.tab?.id || !sender.url?.startsWith(chrome.runtime.getURL('manager.html'))) throw new Error('无效的任务回执。');
      await finish(job, message.state === 'success' ? 'success' : 'error', String(message.message || '任务结束').slice(0, 300));
      return { ok: true };
    }
    if (!isWebsite(sender)) throw new Error('无效的网页来源。');
    if (message.type === 'vs-quick-hover') {
      const hoverKey = 'vs-hover:' + sender.tab.id;
      const previous = (await chrome.storage.session.get(hoverKey))[hoverKey];
      if (sender.frameId && (message.hovered || previous?.documentId === sender.documentId)) {
        const entry = { hovered: !!message.hovered, frameId: sender.frameId, documentId: sender.documentId };
        await chrome.storage.session.set({ [hoverKey]: entry });
        await chrome.tabs.sendMessage(sender.tab.id, { type: 'vs-child-hover', hovered: entry.hovered }, { frameId: 0 }).catch(() => {});
      }
      return { ok: true };
    }
    if (message.type === 'vs-quick-start') return start(message, sender);
    if (message.type === 'vs-quick-cancel') {
      const job = (await chrome.storage.session.get(key(message.jobId)))[key(message.jobId)];
      if (!job || job.sourceTab !== sender.tab.id || ![job.requesterDocumentId, job.documentId].includes(sender.documentId)) return { ok: false };
      await finish(job, 'error', '已取消下载。', true);
      return { ok: true };
    }
    return { ok: false, error: '未知请求。' };
  })().then(reply, error => reply({ ok: false, error: error.message }));
  return true;
});
