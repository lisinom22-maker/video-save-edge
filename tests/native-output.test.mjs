import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeDownload } from '../extension/native-output.mjs';
function api(state = 'complete') {
  const listeners = new Set(); const cancelled = [];
  globalThis.chrome = { downloads: {
    onChanged: { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f) },
    async download(options) { assert.equal(options.conflictAction, 'uniquify'); return 7; },
    async search() { return [{ id: 7, state, filename: 'C:/Downloads/VideoDownloads/clip (1).mp4', fileSize: 123, error: 'NETWORK_FAILED' }]; },
    async cancel(id) { cancelled.push(id); state = 'interrupted'; }
  } };
  return { listeners, cancelled };
}
test('原生下载等待浏览器完成并保留浏览器生成的重名文件名', async () => {
  const mock = api();
  const saved = await nativeDownload('https://site.test/clip.mp4', 'clip.mp4');
  assert.equal(saved.filename, 'clip (1).mp4'); assert.equal(saved.bytes, 123);
  assert.equal(mock.listeners.size, 0);
});
test('原生下载中断必须失败，不能报告成功', async () => {
  const mock = api('interrupted');
  await assert.rejects(nativeDownload('https://site.test/clip.mp4', 'clip.mp4'), /NETWORK_FAILED/);
  assert.equal(mock.listeners.size, 0);
});
test('原生下载取消会取消实际下载并释放监听', async () => {
  const mock = api('in_progress'); const controller = new AbortController();
  const job = nativeDownload('https://site.test/clip.mp4', 'clip.mp4', { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
  await assert.rejects(job, /取消/);
  assert.deepEqual(mock.cancelled, [7]); assert.equal(mock.listeners.size, 0);
});
test('取消请求失败时继续跟踪真实下载，不能提前宣告取消', async () => {
  const mock = api('in_progress'); const controller = new AbortController();
  chrome.downloads.cancel = async () => { throw new Error('Cancel failed'); };
  let ended = false;
  const job = nativeDownload('https://site.test/clip.mp4', 'clip.mp4', { signal: controller.signal }).finally(() => { ended = true; });
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(ended, false); assert.equal(mock.listeners.size, 1);
  chrome.downloads.search = async () => [{ id: 7, state: 'complete', filename: 'C:/Downloads/clip.mp4', fileSize: 123 }];
  for (const listener of mock.listeners) listener({ id: 7, state: { current: 'complete' } });
  assert.equal((await job).bytes, 123); assert.equal(mock.listeners.size, 0);
});
