import './quick-rules.js';
const rules = globalThis.VideoQuickRules;
export async function inspectGeneric(tabId, token, frameId = 0, waitForMedia = false) {
  let targets;
  if (token) {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'vs-quick-describe', token }, { frameId });
    if (!response?.ok || !response.target) throw new Error(response?.error || '视频已变化，请重新悬停并按 Ctrl+C。');
    targets = [{ ...response.target, frameId }];
  } else {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['quick-rules.js', 'quick-content.js'] });
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: ['quick.css'] });
    const deadline = Date.now() + (waitForMedia ? 15000 : 0);
    let candidate = '', stableSince = 0, firstCandidateAt = 0, acceptedTargets = [];
    do {
      const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => globalThis.VideoQuickPage?.list() || [] });
      targets = results.flatMap(result => (result.result || []).map(target => ({ ...target, frameId: result.frameId })));
      if (!waitForMedia) break;
      const eligible = targets.filter(t => ['direct', 'blob'].includes(t.kind) && (t.displayWidth || t.width) * (t.displayHeight || t.height) >= 57600).sort((a, b) => Number(!!b.mainPlayer) - Number(!!a.mainPlayer) || (b.displayWidth || b.width) * (b.displayHeight || b.height) - (a.displayWidth || a.width) * (a.displayHeight || a.height));
      acceptedTargets = eligible;
      const next = eligible[0]?.token || '';
      if (next !== candidate) { candidate = next; stableSince = Date.now(); }
      if (candidate && !firstCandidateAt) firstCandidateAt = Date.now();
      if (candidate && Date.now() - stableSince >= 750 && Date.now() - firstCandidateAt >= 1250) { targets = eligible; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    if (waitForMedia) {
      if (!candidate || Date.now() - stableSince < 750 || Date.now() - firstCandidateAt < 1250) throw new Error('详情页还没有稳定的主视频资源，未自动保存预览。请打开视频后重试。');
      targets = acceptedTargets;
    }
  }
  if (!targets.length) throw new Error('页面中还没有可识别的视频。请先播放视频，再重新识别；也可将鼠标放到视频上按 Ctrl+C。');
  const url = new URL(targets[0].pageURL);
  const pages = targets.map((target, i) => ({ cid: i + 1, page: i + 1, title: target.title + (targets.length > 1 ? ` · 视频 ${i + 1}` : ''), duration: target.duration, target }));
  return { generic: true, bvid: url.hostname, title: targets[0].title, owner: url.hostname, cover: '', pages, selectedCid: 1 };
}
export function genericPlayback(meta, cid) {
  const target = meta.pages.find(p => p.cid === cid)?.target;
  if (!target || target.protected) throw new Error('视频不存在或使用了内容保护。');
  const media = rules.classifyMedia(target.url, target.pageURL, target.mime);
  if (!['direct', 'blob'].includes(media.kind)) throw new Error('此网站的分片流暂不支持。当前版本支持普通 MP4、WebM 与可读取的视频 Blob。');
  return { generic: true, videos: [], audio: null, defaultIndex: 0, direct: { ...target, ...media, label: media.extension === '.webm' ? 'WebM 原文件' : '原始视频' } };
}
