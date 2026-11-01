export class ChunkReceiver {
  constructor(limit) { this.limit = limit; this.bytes = 0; this.next = 0; this.chunks = []; }
  push(index, base64) {
    if (index !== this.next) throw new Error('资源分块顺序异常，请重试。');
    if (typeof base64 !== 'string' || base64.length > 400000) throw new Error('资源分块无效。');
    const raw = atob(base64);
    if (this.bytes + raw.length > this.limit) throw new Error('文件过大，请选择较低画质后重试（合计上限 384 MiB）。');
    const chunk = Uint8Array.from(raw, ch => ch.charCodeAt(0));
    this.chunks.push(chunk); this.bytes += chunk.length; this.next++;
  }
  finish(expected) {
    if (expected !== this.bytes || this.bytes === 0) throw new Error('资源下载不完整，请重试。');
    const output = new Uint8Array(this.bytes);
    let offset = 0;
    for (const c of this.chunks) { output.set(c, offset); offset += c.length; }
    this.chunks = [];
    return output;
  }
}
export function receiveStream(port, options, signal, onProgress = () => {}, onMetadata = () => {}) {
  return new Promise((resolve, reject) => {
    const receiver = new ChunkReceiver(options.limit);
    let done = false;
    let timeout;
    function resetTimeout() { clearTimeout(timeout); timeout = setTimeout(() => settle(new Error('下载连接超时，请检查网络后重试。')), 60000); }
    function settle(error, output) {
      if (done) return;
      done = true; clearTimeout(timeout);
      port.onMessage.removeListener(message);
      port.onDisconnect.removeListener(disconnected);
      signal?.removeEventListener('abort', cancelled);
      try { port.disconnect(); } catch {}
      receiver.chunks = [];
      if (error) reject(error); else resolve(output);
    }
    const cancelled = () => settle(new Error('已取消下载。'));
    const disconnected = () => settle(new Error('来源视频页已关闭、刷新或连接断开，请重新识别后重试。'));
    function message(msg) {
      if (done) return;
      resetTimeout();
      try {
        if (msg.type === 'meta') onMetadata(msg);
        else if (msg.type === 'chunk') {
          receiver.push(msg.index, msg.data);
          onProgress(receiver.bytes, msg.total || 0);
          port.postMessage({ type: 'ack', index: msg.index });
        } else if (msg.type === 'end') {
          settle(null, receiver.finish(msg.bytes));
        } else if (msg.type === 'error') settle(new Error(msg.error || '资源下载失败。'));
      } catch (error) { settle(error); }
    }
    port.onMessage.addListener(message);
    port.onDisconnect.addListener(disconnected);
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) { cancelled(); return; }
    resetTimeout();
    try { port.postMessage({ type: 'start', ...options }); } catch (error) { settle(error); }
  });
}
