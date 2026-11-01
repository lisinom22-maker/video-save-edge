(() => {
  if (globalThis.VideoQuickPage) return;
  document.querySelectorAll('.vs-quick-toast').forEach(element => element.remove());
  const rules = globalThis.VideoQuickRules;
  const version = chrome.runtime.getManifest().version;
  function sendRuntime(message) {
    try { return Promise.resolve(chrome.runtime.sendMessage(message)); }
    catch (error) { return Promise.reject(error); }
  }
  let point = null, lastPress = -Infinity, lastToken = null, toast, toastTimer, activeJob;
  const finishedJobs = new Set();
  let lastHover = false, childHovered = false;
  const targets = new Map();
  const ids = new WeakMap();
  let videoCache = null, cacheTime = 0, lastHoverCheck = -Infinity;
  new MutationObserver(() => { videoCache = null; }).observe(document.documentElement, { childList: true, subtree: true });
  function allVideos(root = document) {
    if (root === document && videoCache && performance.now() - cacheTime < 1000) return videoCache.filter(v => v.isConnected);
    const found = [...root.querySelectorAll('video')];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) found.push(...allVideos(el.shadowRoot));
    if (root === document) { videoCache = found; cacheTime = performance.now(); }
    return found;
  }
  function visible(video) { const r = video.getBoundingClientRect(), s = getComputedStyle(video); return r.width > 5 && r.height > 5 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0; }
  function linkAt(element) {
    const link = element?.closest('a[href],[data-video-url],[data-video-src]');
    if (!link || !visible(link)) return null;
    const hasImage = !!link.querySelector('img,picture');
    const videoHint = link.matches('[data-video-url],[data-video-src]') || !!link.querySelector('video') || /video|视频/i.test(String(link.className) + ' ' + (link.getAttribute('aria-label') || ''));
    const media = rules.classifyVideoLink(link.href || link.getAttribute('data-video-url') || link.getAttribute('data-video-src'), location.href, { hasImage, videoHint });
    return media ? { link, media, hasImage, videoHint } : null;
  }
  function hovered() {
    if (!point) return null;
    const { x, y } = point;
    let top = document.elementFromPoint(x, y);
    while (top?.shadowRoot?.elementFromPoint(x, y)) { const next = top.shadowRoot.elementFromPoint(x, y); if (next === top) break; top = next; }
    const card = linkAt(top);
    if (card) return card.link;
    if (top?.localName === 'video' && visible(top)) return top;
    for (const v of allVideos()) {
      if (!visible(v)) continue;
      const r = v.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      // Allow controls/transparent player overlays, but not an unrelated modal over the page.
      for (let p = v.parentElement, depth = 0; p && depth < 4; p = p.parentElement, depth++) {
        const box = p.getBoundingClientRect();
        if (p.contains(top) && box.width * box.height <= r.width * r.height * 1.8 && p !== document.body) return v;
      }
    }
    return null;
  }
  function describe(video) {
    if (!video?.isConnected) return null;
    let token = ids.get(video);
    if (!token) { token = crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint32Array(4))].join('-'); ids.set(video, token); }
    const src = resourceSource(video);
    if (video.localName !== 'video') {
      const card = linkAt(video);
      if (!card) return null;
      const target = { ...card.media, token, title: video.getAttribute('title') || video.getAttribute('aria-label') || video.querySelector('img')?.alt || video.textContent?.trim().slice(0, 160) || document.title || '视频', pageURL: location.href, duration: 0, width: Math.round(video.getBoundingClientRect().width), height: Math.round(video.getBoundingClientRect().height), mime: '', protected: false, card: true, hasImage: card.hasImage, videoHint: card.videoHint };
      targets.set(token, { video, url: src });
      if (targets.size > 64) targets.delete(targets.keys().next().value);
      return target;
    }
    const mime = video.getAttribute('type') || video.querySelector('source[type]')?.type || '';
    const bili = /^(www\.|m\.)?bilibili\.com$/.test(location.hostname) && /^\/video\/(BV[a-zA-Z0-9]{10}|av\d+)\/?$/.test(location.pathname);
    const media = bili ? { kind: 'bilibili', url: '', extension: '.mp4' } : rules.classifyMedia(src, location.href, mime);
    const target = { ...media, token, title: video.getAttribute('title') || video.getAttribute('aria-label') || video.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || document.title || '视频', pageURL: location.href, duration: Number.isFinite(video.duration) ? video.duration : 0, width: video.videoWidth || Math.round(video.getBoundingClientRect().width), height: video.videoHeight || Math.round(video.getBoundingClientRect().height), mime, protected: !!video.mediaKeys };
    target.displayWidth = Math.round(video.getBoundingClientRect().width); target.displayHeight = Math.round(video.getBoundingClientRect().height);
    target.mainPlayer = !!video.closest('main,[role="main"],#player,#bilibili-player,.bpx-player-container');
    targets.set(token, { video, url: src });
    if (targets.size > 64) targets.delete(targets.keys().next().value);
    return target;
  }
  function resourceSource(element) { return element.localName === 'video' ? element.currentSrc || element.src || element.querySelector('source[src]')?.src || '' : element.href || element.getAttribute('data-video-url') || element.getAttribute('data-video-src') || ''; }
  function targetByToken(token) {
    const stored = targets.get(token);
    if (!stored || !stored.video.isConnected) throw new Error('视频已从页面移除，请重新把鼠标放到视频上。');
    const target = describe(stored.video);
    if (resourceSource(stored.video) !== stored.url) throw new Error('视频资源已变化，请重新触发下载。');
    return target;
  }
  function show(message, state = 'info', jobId) {
    if (!toast?.isConnected) {
      toast = document.createElement('div'); toast.className = 'vs-quick-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
      const text = document.createElement('span'); text.className = 'vs-quick-text'; toast.append(text);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '取消'; button.addEventListener('click', () => { if (activeJob) sendRuntime({ type: 'vs-quick-cancel', jobId: activeJob }).catch(() => {}); }); toast.append(button);
      (document.body || document.documentElement).append(toast);
    }
    if (jobId) activeJob = jobId;
    toast.querySelector('.vs-quick-text').textContent = message;
    toast.dataset.state = state; toast.hidden = false;
    toast.querySelector('button').hidden = state !== 'pending' || !activeJob;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, state === 'error' ? 10000 : 6500);
  }
  function reportHover() {
    if (point && performance.now() - lastHoverCheck < 80) return;
    lastHoverCheck = performance.now();
    const yes = !!hovered();
    if (yes === lastHover) return;
    lastHover = yes;
    sendRuntime({ type: 'vs-quick-hover', hovered: yes }).catch(() => {});
  }
  document.addEventListener('pointermove', event => { point = { x: event.clientX, y: event.clientY }; if (window === window.top && document.elementFromPoint(point.x, point.y)?.localName !== 'iframe') childHovered = false; reportHover(); }, { capture: true, passive: true });
  document.addEventListener('pointerover', event => { point = { x: event.clientX, y: event.clientY }; reportHover(); }, { capture: true, passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) { if (!point || document.elementFromPoint(point.x, point.y)?.localName !== 'iframe') point = null; reportHover(); } }, { capture: true, passive: true });
  document.addEventListener('scroll', () => reportHover(), { capture: true, passive: true });
  function editing(event) { return event.composedPath().some(el => el instanceof Element && (el.matches('input,textarea,select,[role="textbox"],[role="combobox"]') || el.isContentEditable)); }
  window.addEventListener('keydown', event => {
    // Retired listeners can remain on an old webpage after extension reload.
    // They must not consume the shortcut before the new connection handles it.
    if (!chrome.runtime.id) return;
    if (!event.isTrusted || !rules.isCopyShortcut(event, { editable: editing(event), selectedText: window.getSelection()?.toString() })) return;
    const overFrame = window === window.top && childHovered;
    const video = overFrame ? null : hovered();
    if (!video && !(overFrame && childHovered)) return;
    const target = video ? describe(video) : null;
    if (lastToken === (target?.token || 'child') && performance.now() - lastPress < 1200) return;
    if (target?.protected) { show('该视频使用内容保护，无法保存。', 'error'); return; }
    if (target?.kind === 'unsupported') { show('当前视频没有可直接保存的 MP4/WebM 资源；此网站的分片流暂不支持。', 'error'); return; }
    event.preventDefault(); event.stopImmediatePropagation(); lastPress = performance.now(); lastToken = target?.token || 'child';
    show('正在开始下载…', 'info');
    sendRuntime({ type: 'vs-quick-start', token: target?.token || null, childFrame: !video }).then(result => {
      if (!result?.ok) throw new Error(result?.error || '无法开始下载。');
      if (finishedJobs.has(result.jobId)) return;
      show(result.duplicate ? '这个视频已经在下载中。' : result.needsFolder ? '请在打开的面板选择“视频”文件夹（仅首次）。' : '正在解析并保存到所选视频文件夹…', 'pending', result.jobId);
    }).catch(error => show(/context invalidated/i.test(error.message) ? '插件已更新，请刷新这个网页后重试。' : error.message, 'error'));
  }, true);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'vs-quick-ping') { reply({ ready: true, version }); return; }
    if (message.type === 'vs-quick-describe') { try { reply({ ok: true, target: message.token ? targetByToken(message.token) : describe(hovered()) }); } catch (error) { reply({ ok: false, error: error.message }); } }
    if (message.type === 'vs-quick-feedback') { if (message.state !== 'pending') { finishedJobs.add(message.jobId); if (message.state === 'error') lastPress = -Infinity; if (finishedJobs.size > 32) finishedJobs.delete(finishedJobs.values().next().value); } show(message.message, message.state, message.jobId); reply({ ok: true }); }
    if (message.type === 'vs-child-hover') { childHovered = message.hovered; reply({ ok: true }); }
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'vs-blob-fetch' || port.sender?.id !== chrome.runtime.id) return;
    const controller = new AbortController();
    let waiting, timer, started = false;
    port.onDisconnect.addListener(() => { controller.abort(); clearTimeout(timer); waiting?.reject(new Error('已取消下载。')); waiting = null; });
    port.onMessage.addListener(message => {
      if (message.type === 'ack' && waiting && message.index === waiting.index) { clearTimeout(timer); waiting.resolve(); waiting = null; return; }
      if (message.type !== 'start' || started) return;
      started = true;
      (async () => {
        const target = targetByToken(message.token);
        if (target.kind !== 'blob' || target.protected) throw new Error('视频资源类型已变化，请重新选择。');
        const limit = Math.min(Number(message.limit) || 0, 384 * 1024 * 1024);
        if (limit <= 0) throw new Error('无效的下载请求。');
        let response;
        try { response = await fetch(target.url, { signal: controller.signal }); }
        catch { throw new Error('这个 blob 地址属于分片播放器，暂不能直接保存；请使用网站专用下载方式。'); }
        if (!response.ok || !response.body) throw new Error('视频 Blob 已失效，请重新播放后重试。');
        const total = Number(response.headers.get('content-length')) || 0;
        const mime = response.headers.get('content-type')?.split(';')[0] || target.mime || 'video/mp4';
        if (!['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'application/octet-stream'].includes(mime)) throw new Error('该 Blob 不是支持的视频文件。');
        port.postMessage({ type: 'meta', mime });
        if (total > limit) { await response.body.cancel(); throw new Error('文件过大（上限 384 MiB）。'); }
        const reader = response.body.getReader(); let bytes = 0, index = 0;
        try {
          while (true) {
            const read = await reader.read(); if (read.done) break;
            for (let offset = 0; offset < read.value.length; offset += 196608) {
              const chunk = read.value.subarray(offset, offset + 196608);
              if (bytes + chunk.length > limit) throw new Error('文件过大（上限 384 MiB）。');
              let text = ''; for (let n = 0; n < chunk.length; n += 8192) text += String.fromCharCode(...chunk.subarray(n, n + 8192));
              const ack = new Promise((resolve, reject) => { waiting = { resolve, reject, index }; timer = setTimeout(() => { waiting = null; reject(new Error('下载面板连接超时。')); }, 30000); });
              port.postMessage({ type: 'chunk', index, data: btoa(text), total }); await ack;
              index++; bytes += chunk.length;
            }
          }
          if (!bytes || (total && bytes !== total)) throw new Error('视频下载不完整。');
          port.postMessage({ type: 'end', bytes });
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      })().catch(error => { try { port.postMessage({ type: 'error', error: error.message }); } catch {} }).finally(() => clearTimeout(timer));
    });
  });
  globalThis.VideoQuickPage = Object.freeze({ list: () => allVideos().filter(visible).map(describe), describe: targetByToken });
})();
