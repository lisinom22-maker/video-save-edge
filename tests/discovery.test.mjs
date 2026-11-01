import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGeneric } from '../extension/generic.mjs';

test('未打开的详情页先出现小预览时，等待主视频，不能立即下载预览', async () => {
  let probes = 0;
  const preview = { token: 'preview', kind: 'direct', url: 'https://cdn.test/preview.mp4', pageURL: 'https://site.test/watch/42', title: 'preview', duration: 1, width: 160, height: 90 };
  const main = { token: 'main', kind: 'direct', url: 'https://cdn.test/main.webm', pageURL: 'https://site.test/watch/42', title: 'main', duration: 20, width: 1280, height: 720 };
  globalThis.chrome = { scripting: {
    async executeScript(options) { if (options.files) return []; probes++; return [{ frameId: 0, result: probes === 1 ? [preview] : [preview, main] }]; },
    async insertCSS() {}
  } };
  const meta = await inspectGeneric(1, null, 0, true);
  assert.equal(meta.pages[0].target.url, 'https://cdn.test/main.webm');
  assert.ok(probes >= 2);
});
