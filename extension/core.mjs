export const MAX_BYTES = 384 * 1024 * 1024;
const CDN_DOMAINS = ['bilivideo.com', 'bilivideo.cn'];
export function isMediaURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && (u.hostname === 'upos-hz-mirrorakam.akamaized.net' || CDN_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d)));
  } catch { return false; }
}
export function parseVideoURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(u.hostname)) throw new Error('请先打开 B站普通视频页，再点击插件图标。');
  const match = u.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10}|av\d+)\/?$/);
  if (!match) throw new Error('第一版支持 B站普通视频页（BV / av），暂不支持番剧、课程和直播。');
  const n = Number(u.searchParams.get('p'));
  const page = Number.isSafeInteger(n) && n > 0 ? n : 1;
  return match[1].startsWith('BV') ? { bvid: match[1], page } : { aid: match[1].slice(2), page };
}
export function safeFilename(value, extension = '') {
  let name = String(value || 'B站视频').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120).replace(/[. ]+$/g, '');
  if (!name) name = 'B站视频';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name + extension;
}
export function normalizeVideoInfo(data, page = 1) {
  if (!data || !/^BV[a-zA-Z0-9]{10}$/.test(data.bvid)) throw new Error('未能识别视频信息，请刷新来源视频页后重试。');
  const pages = (data.pages || []).filter(p => Number.isSafeInteger(p.cid) && p.cid > 0).map(p => ({ cid: p.cid, page: p.page, title: String(p.part || `第 ${p.page} P`), duration: Number(p.duration) || 0 }));
  if (!pages.length) throw new Error('这个视频没有可用的分P信息。');
  const cover = String(data.pic || '').replace(/^http:/, 'https:');
  const coverURL = (() => { try { const u = new URL(cover); return u.protocol === 'https:' && u.hostname.endsWith('.hdslb.com') ? cover : ''; } catch { return ''; } })();
  return { bvid: data.bvid, aid: data.aid, title: String(data.title || data.bvid), owner: String(data.owner?.name || '未知 UP主'), cover: coverURL, pages, selectedCid: (pages.find(p => p.page === page) || pages[0]).cid };
}
const QUALITIES = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P 60帧', 112: '1080P 高码率', 80: '1080P', 74: '720P 60帧', 64: '720P', 48: '720P', 32: '480P', 16: '360P', 6: '240P' };
function normalizeStream(s, labels) {
  const urls = [s.baseUrl || s.base_url || s.url, ...(s.backupUrl || s.backup_url || [])].filter(isMediaURL);
  if (!urls.length || s.drm || s.drmType || s.drm_type) return null;
  const codecs = String(s.codecs || '');
  return { quality: Number(s.id), label: labels[s.id] || QUALITIES[s.id] || `画质 ${s.id}`, codecs, codecLabel: /^avc/i.test(codecs) ? 'H.264' : /^(hev|hvc)/i.test(codecs) ? 'HEVC' : /^av01/i.test(codecs) ? 'AV1' : codecs, mime: s.mimeType || s.mime_type || '', url: urls[0], urls, bandwidth: Number(s.bandwidth) || 0, width: Number(s.width) || 0, height: Number(s.height) || 0 };
}
export function normalizePlayInfo(input) {
  const data = input?.data || input?.result?.video_info || input?.result || input;
  if (!data) throw new Error('没有获取到播放资源。');
  if (data.is_preview || data.isPreview) throw new Error('当前资源是试看内容，请先确认账号具有完整观看权限。');
  if (data.is_drm || data.drm_tech_type || data.drm) throw new Error('该视频使用了内容保护，无法保存。');
  const labels = Object.fromEntries((data.support_formats || []).map(s => [s.quality, s.new_description || s.display_desc || QUALITIES[s.quality]]));
  const videos = (data.dash?.video || []).map(s => normalizeStream(s, labels)).filter(s => s && (!s.mime || s.mime === 'video/mp4'));
  videos.sort((a, b) => b.quality - a.quality || Number(/^avc/.test(b.codecs)) - Number(/^avc/.test(a.codecs)) || b.bandwidth - a.bandwidth);
  const audios = (data.dash?.audio || []).map(s => normalizeStream(s, {})).filter(s => s && /^mp4a/i.test(s.codecs)).sort((a, b) => b.bandwidth - a.bandwidth);
  if (videos.length) {
    let defaultIndex = videos.findIndex(s => ![125, 126, 127].includes(s.quality) && /^avc/i.test(s.codecs));
    if (defaultIndex < 0) defaultIndex = videos.findIndex(s => ![125, 126, 127].includes(s.quality));
    return { videos, audio: audios[0] || null, defaultIndex: Math.max(0, defaultIndex), direct: null };
  }
  if (data.durl?.length === 1 && (/mp4/i.test(data.format || '') || /\.mp4(?:\?|$)/i.test(data.durl[0].url || ''))) {
    const direct = normalizeStream({ ...data.durl[0], id: data.quality }, labels);
    if (direct) return { videos: [], audio: null, defaultIndex: 0, direct };
  }
  throw new Error('没有可下载的 MP4 资源，或当前格式暂不支持。请登录并播放视频后重试。');
}

// RFC 1321, used solely for Bilibili WBI request signing.
export function md5(text) {
  const input = new TextEncoder().encode(text);
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input); bytes[input.length] = 128;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, (input.length * 8) >>> 0, true);
  view.setUint32(bytes.length - 4, Math.floor(input.length / 0x20000000), true);
  const shift = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      const round = i >>> 4;
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const sum = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) + view.getUint32(offset + g * 4, true)) | 0;
      const s = shift[round * 4 + i % 4];
      [a, b, c, d] = [d, (b + ((sum << s) | (sum >>> (32 - s)))) | 0, b, c];
    }
    state = state.map((v, i) => (v + [a, b, c, d][i]) | 0);
  }
  return state.map(v => [0, 8, 16, 24].map(n => ((v >>> n) & 255).toString(16).padStart(2, '0')).join('')).join('');
}
export function signWbi(params, key, timestamp = Math.floor(Date.now() / 1000)) {
  const values = { ...params, wts: timestamp };
  const query = Object.keys(values).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(values[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return query + '&w_rid=' + md5(query + key);
}
export function mixinKey(imgURL, subURL) {
  const raw = [imgURL, subURL].map(u => new URL(u).pathname.split('/').pop().split('.')[0]).join('');
  if (raw.length < 64) throw new Error('站点签名信息不完整，请刷新视频页后重试。');
  const table = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
  return table.map(i => raw[i]).join('').slice(0, 32);
}
