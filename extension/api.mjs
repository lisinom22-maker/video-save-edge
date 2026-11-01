import { parseVideoURL, normalizeVideoInfo, normalizePlayInfo, mixinKey, signWbi } from './core.mjs';

async function inSource(tabId, func, args = []) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
    if (!result?.ok) throw new Error(result?.error || '来源页面没有响应。');
    return result.value;
  } catch (error) {
    if (/No tab|Cannot access|removed|frame|No frame/i.test(error.message)) throw new Error('来源视频页已关闭或刷新，请回到视频页重新点击插件。');
    throw error;
  }
}
async function request(tabId, path) {
  return inSource(tabId, async path => {
    try {
      const url = new URL(path, 'https://api.bilibili.com');
      if (url.origin !== 'https://api.bilibili.com' || !['/x/web-interface/view', '/x/web-interface/nav', '/x/player/wbi/playurl'].includes(url.pathname)) throw new Error('无效的站点请求。');
      const r = await fetch(url.href, { credentials: 'include', signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`B站接口返回 HTTP ${r.status}，请稍后重试。`);
      const json = await r.json();
      const publicNav = url.pathname === '/x/web-interface/nav' && json.code === -101 && json.data?.wbi_img;
      if (json.code !== 0 && !publicNav) throw new Error(json.code === -101 ? '请先在来源视频页登录 B站，再重新识别。' : json.code === -352 || json.code === -412 ? 'B站暂时限制了请求，请在视频页正常播放后稍后重试。' : `B站接口：${json.message || json.code}`);
      return { ok: true, value: json.data };
    } catch (error) { return { ok: false, error: error.name === 'TimeoutError' ? '请求超时，请检查网络后重试。' : error.message }; }
  }, [path]);
}
export async function inspectVideo(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const context = parseVideoURL(tab.url);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const cached = await inSource(tabId, expected => {
    const video = window.__INITIAL_STATE__?.videoData;
    const matches = video && (expected.bvid ? video.bvid === expected.bvid : String(video.aid) === expected.aid);
    return { ok: true, value: matches ? { bvid: video.bvid, aid: video.aid, title: video.title, pic: video.pic, owner: { name: video.owner?.name }, pages: video.pages } : null };
  }, [context]).catch(() => null);
  if (cached) return normalizeVideoInfo(cached, context.page);
  const query = new URLSearchParams(context.bvid ? { bvid: context.bvid } : { aid: context.aid });
  const info = await request(tabId, '/x/web-interface/view?' + query);
  return normalizeVideoInfo(info, context.page);
}
export async function getPlayback(tabId, meta, cid) {
  try {
    const nav = await request(tabId, '/x/web-interface/nav');
    const key = mixinKey(nav.wbi_img.img_url, nav.wbi_img.sub_url);
    const query = signWbi({ bvid: meta.bvid, cid, qn: 127, fnver: 0, fnval: 4048, fourk: 1 }, key);
    const result = normalizePlayInfo(await request(tabId, '/x/player/wbi/playurl?' + query));
    return { ...result, loggedIn: !!nav.isLogin, fromPlayer: false };
  } catch (originalError) {
    // Use only an exact video + cid match; a stale SPA player must never save the wrong P.
    const cached = await inSource(tabId, (bvid, cid) => {
      const state = window.__INITIAL_STATE__;
      const video = state?.videoData;
      const currentCid = state?.cid || video?.cid;
      return { ok: true, value: video?.bvid === bvid && Number(currentCid) === cid ? window.__playinfo__ || null : null };
    }, [meta.bvid, cid]).catch(() => null);
    if (!cached) throw originalError;
    return { ...normalizePlayInfo(cached), loggedIn: null, fromPlayer: true };
  }
}
