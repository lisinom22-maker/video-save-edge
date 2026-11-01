export async function nativeDownload(url, filename, { signal } = {}) {
  if (signal?.aborted) throw new Error('已取消下载。');
  const api = globalThis.chrome.downloads;
  let id, settled = false, resolve, reject, cancelling = false;
  const done = new Promise((yes, no) => { resolve = yes; reject = no; });
  const finish = (error, item) => {
    if (settled) return;
    settled = true;
    error ? reject(error) : resolve({ filename: item.filename.split(/[\\/]/).pop(), relativePath: item.filename, bytes: item.fileSize });
  };
  const inspect = item => {
    if (item.state === 'complete') finish(null, item);
    if (item.state === 'interrupted') finish(new Error(signal?.aborted ? '已取消下载。' : '浏览器下载中断：' + (item.error || '请重试')));
  };
  const changed = delta => { if (delta.id === id) api.search({ id }).then(items => { if (items[0]) inspect(items[0]); }).catch(finish); };
  const abort = () => {
    if (id === undefined || cancelling || settled) return;
    cancelling = true;
    // A failed cancel does not mean the download stopped. Keep watching until
    // the browser reports a terminal state, retaining any Blob URL meanwhile.
    api.cancel(id).catch(() => {}).then(() => api.search({ id })).then(items => {
      if (items[0]) inspect(items[0]);
    }).catch(() => {}).finally(() => { cancelling = false; });
  };
  api.onChanged.addListener(changed);
  signal?.addEventListener('abort', abort, { once: true });
  // Avoid an unhandled rejection if cancellation happens while download() starts.
  done.catch(() => {});
  try {
    id = await api.download({ url, filename: 'VideoDownloads/' + filename, conflictAction: 'uniquify', saveAs: false });
    if (signal?.aborted) { abort(); }
    else { const items = await api.search({ id }); if (items[0]) inspect(items[0]); }
    return await done;
  } finally { api.onChanged.removeListener(changed); signal?.removeEventListener('abort', abort); }
}
export async function nativeSave(source, filename, options = {}) {
  let blob = source;
  if (!(source instanceof Blob)) {
    const reader = source.getReader(); const chunks = []; let bytes = 0;
    const abort = () => reader.cancel().catch(() => {});
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      while (true) {
        if (options.signal?.aborted) throw new Error('已取消下载。');
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 384 * 1024 * 1024) throw new Error('浏览器内存处理上限 384 MiB。');
        chunks.push(value); options.onProgress?.(bytes);
      }
      if (!bytes || (options.expectedBytes && bytes !== options.expectedBytes)) throw new Error('视频数据不完整。');
      blob = new Blob(chunks);
    } finally { options.signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const url = URL.createObjectURL(blob);
  try { return await nativeDownload(url, filename, options); }
  finally { URL.revokeObjectURL(url); }
}
