(() => {
  if (globalThis.__biliSaveTransfer) return;
  globalThis.__biliSaveTransfer = true;
  const allowed = value => {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && (u.hostname === 'upos-hz-mirrorakam.akamaized.net' || ['bilivideo.com', 'bilivideo.cn'].some(d => u.hostname === d || u.hostname.endsWith('.' + d))); } catch { return false; }
  };
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'bili-save-fetch' || port.sender?.id !== chrome.runtime.id) return;
    const controller = new AbortController();
    let started = false;
    let ack = null;
    let expectedAck = -1;
    let ackTimer;
    let idleTimer;
    const cancel = () => { controller.abort(); clearTimeout(idleTimer); clearTimeout(ackTimer); if (ack) { ack.reject(new Error('已取消下载。')); ack = null; } };
    port.onDisconnect.addListener(cancel);
    const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => controller.abort(), 45000); };
    port.onMessage.addListener(msg => {
      if (msg.type === 'ack' && ack && msg.index === expectedAck) { clearTimeout(ackTimer); const resolve = ack.resolve; ack = null; resolve(); return; }
      if (msg.type !== 'start' || started) return;
      started = true;
      run(msg).catch(error => { try { port.postMessage({ type: 'error', error: controller.signal.aborted ? '下载连接超时或已取消，请重试。' : error.message }); } catch {} }).finally(() => { clearTimeout(idleTimer); clearTimeout(ackTimer); });
    });
    async function run({ urls, limit }) {
      if (!Array.isArray(urls) || !urls.length || urls.length > 12 || !urls.every(allowed) || !Number.isSafeInteger(limit) || limit <= 0 || limit > 384 * 1024 * 1024) throw new Error('无效的下载请求。');
      let response;
      let lastError;
      for (const url of urls) {
        try {
          touch();
          response = await fetch(url, { credentials: 'omit', signal: controller.signal, referrer: 'https://www.bilibili.com/', referrerPolicy: 'strict-origin-when-cross-origin' });
          if (!allowed(response.url)) throw new Error('资源重定向到了暂不支持的地址。');
          if (!response.ok) throw new Error(`资源服务器返回 HTTP ${response.status}，请重新识别视频后重试。`);
          break;
        } catch (error) { lastError = error; if (controller.signal.aborted) throw error; response = null; }
      }
      if (!response) throw lastError || new Error('无法连接视频资源服务器。');
      const total = Number(response.headers.get('content-length')) || 0;
      const contentType = response.headers.get('content-type') || '';
      if (/text\/|json|html/i.test(contentType)) throw new Error('服务器返回了错误页面，未保存为视频。请重新识别后重试。');
      if (total > limit) { await response.body.cancel().catch(() => {}); throw new Error('文件过大，请选择较低画质后重试（合计上限 384 MiB）。'); }
      const reader = response.body.getReader();
      let bytes = 0, index = 0;
      try {
        while (true) {
          touch();
          const { value, done } = await reader.read();
          if (done) break;
          for (let offset = 0; offset < value.length; offset += 196608) {
            const chunk = value.subarray(offset, offset + 196608);
            if (bytes + chunk.length > limit) throw new Error('文件过大，请选择较低画质后重试（合计上限 384 MiB）。');
            let binary = '';
            for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
            const waiting = new Promise((resolve, reject) => { ack = { resolve, reject }; expectedAck = index; ackTimer = setTimeout(() => { ack = null; reject(new Error('下载面板没有响应，请重试。')); }, 30000); });
            port.postMessage({ type: 'chunk', index, data: btoa(binary), total });
            await waiting;
            bytes += chunk.length; index++;
          }
        }
        if (!bytes || (total && bytes !== total)) throw new Error('资源下载不完整，请重试。');
        port.postMessage({ type: 'end', bytes });
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  });
})();
