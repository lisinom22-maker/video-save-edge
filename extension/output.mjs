const DB_NAME = 'video-save-output';
let database;
async function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => { database = null; reject(request.error); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
  });
  return database;
}
export async function selectedDirectory() {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const request = connection.transaction('settings').objectStore('settings').get('directory');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
export async function setOutputDirectory(handle) {
  if (!handle || handle.kind !== 'directory') throw new Error('请选择一个文件夹。');
  if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('需要允许本插件向所选文件夹保存视频。');
  const connection = await db();
  await new Promise((resolve, reject) => {
    const transaction = connection.transaction('settings', 'readwrite');
    transaction.objectStore('settings').put(handle, 'directory');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('保存文件夹设置失败。'));
  });
  return outputStatus();
}
export async function outputStatus() {
  try {
    const directory = await selectedDirectory();
    if (!directory) return { allowed: false, label: '尚未选择系统“视频”文件夹' };
    const allowed = await directory.queryPermission({ mode: 'readwrite' }) === 'granted';
    return { allowed, label: `${directory.name}${directory.name === 'VideoDownloads' ? '' : '/VideoDownloads'}` };
  } catch { return { allowed: false, label: '需要重新选择保存文件夹' }; }
}
export async function chooseOutputDirectory() {
  if (!globalThis.showDirectoryPicker) throw new Error('当前浏览器不支持文件夹选择，请使用新版 Edge。');
  const handle = await showDirectoryPicker({ id: 'video-save-output', startIn: 'videos', mode: 'readwrite' });
  return setOutputDirectory(handle);
}
function cancelled(signal) { if (signal?.aborted) throw new Error('已取消下载。'); }
function validFilename(name) {
  if (typeof name !== 'string' || !name || name.length > 200 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || !/\.(mp4|webm|ogv|mov|m4a|jpg|png|webp)$/i.test(name)) throw new Error('无效的输出文件名。');
}
export async function writeFileToDirectory(directory, source, requestedName, { signal, onProgress = () => {}, expectedBytes } = {}) {
  validFilename(requestedName); cancelled(signal);
  const reserve = async () => {
    for (let index = 0; index < 10000; index++) {
      cancelled(signal);
      const dot = requestedName.lastIndexOf('.');
      const filename = index ? `${requestedName.slice(0, dot)} (${index})${requestedName.slice(dot)}` : requestedName;
      try { await directory.getFileHandle(filename); }
      catch (error) {
        if (error.name !== 'NotFoundError') throw error;
        return { filename, handle: await directory.getFileHandle(filename, { create: true }) };
      }
    }
    throw new Error('同名文件太多，请更换文件名。');
  };
  const reserved = globalThis.navigator?.locks ? await navigator.locks.request('video-save-reserve-name', reserve) : await reserve();
  const stream = source instanceof Blob ? source.stream() : source;
  let writer, reader, bytes = 0, complete = false;
  const abort = () => { reader?.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    cancelled(signal);
    writer = await reserved.handle.createWritable({ keepExistingData: false });
    reader = stream.getReader();
    while (true) {
      cancelled(signal);
      const { value, done } = await reader.read();
      cancelled(signal);
      if (done) break;
      await writer.write(value);
      bytes += value.byteLength;
      onProgress(bytes);
    }
    if (!bytes || (Number.isFinite(expectedBytes) && expectedBytes > 0 && expectedBytes !== bytes)) throw new Error('视频数据不完整，未保存为成功文件。');
    cancelled(signal);
    await writer.close(); complete = true;
    return { filename: reserved.filename, bytes };
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {}); reader?.releaseLock();
    if (!complete) {
      await writer?.abort().catch(() => {});
      // Only remove our newly reserved, still-empty file, never an existing user file.
      try { if ((await reserved.handle.getFile()).size === 0) await directory.removeEntry(reserved.filename); } catch {}
    }
  }
}
export async function saveToSelectedDirectory(source, filename, options = {}) {
  const root = await selectedDirectory();
  if (!root || await root.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('请先点击“选择视频文件夹”，允许保存到系统“视频”位置。');
  const directory = root.name === 'VideoDownloads' ? root : await root.getDirectoryHandle('VideoDownloads', { create: true });
  const saved = await writeFileToDirectory(directory, source, filename, options);
  return { ...saved, relativePath: `${root.name}${root.name === 'VideoDownloads' ? '' : '/VideoDownloads'}/${saved.filename}` };
}
