import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as output from '../extension/output.mjs';

// Only the external browser filesystem boundary is adapted; actual bytes reach disk.
async function directoryForTest() {
  const base = path.resolve('.test'); await mkdir(base, { recursive: true });
  const folder = await mkdtemp(path.join(base, 'output-unit-'));
  const directory = {
    name: 'VideoDownloads',
    async getFileHandle(name, { create = false } = {}) {
      const file = path.join(folder, name);
      try { await readFile(file); } catch { if (!create) throw Object.assign(new Error('Not found'), { name: 'NotFoundError' }); await writeFile(file, ''); }
      return { async getFile() { return new Blob([await readFile(file)]); }, async createWritable() {
        const tmp = file + '.partial'; await writeFile(tmp, ''); let parts = [];
        return { async write(data) { parts.push(data); }, async close() { await writeFile(tmp, Buffer.concat(parts.map(x => Buffer.from(x)))); await rename(tmp, file); }, async abort() { await unlink(tmp).catch(() => {}); } };
      } };
    },
    async removeEntry(name) { await unlink(path.join(folder, name)); }
  };
  return { directory, folder };
}

test('选择的目录写入原始视频字节，重名自动编号，不能覆盖已有文件', async () => {
  const { directory, folder } = await directoryForTest();
  await writeFile(path.join(folder, 'clip.mp4'), 'original');
  const saved = await output.writeFileToDirectory?.(directory, new Blob([new Uint8Array([0, 1, 2, 3])]), 'clip.mp4');
  assert.equal(saved?.filename, 'clip (1).mp4');
  assert.deepEqual([...await readFile(path.join(folder, 'clip (1).mp4'))], [0, 1, 2, 3]);
  assert.equal(await readFile(path.join(folder, 'clip.mp4'), 'utf8'), 'original');
});

test('流式写入取消后不留下伪装成成功视频的空文件或部分文件', async () => {
  const { directory, folder } = await directoryForTest();
  const controller = new AbortController();
  const source = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); }, cancel() {} });
  await assert.rejects(output.writeFileToDirectory?.(directory, source, 'cancel.mp4', { signal: controller.signal, onProgress() { controller.abort(); } }), /取消/);
  assert.deepEqual(await readdir(folder), []);
});

test('拒绝通过输出文件名写入选择目录之外', async () => {
  const { directory } = await directoryForTest();
  await assert.rejects(output.writeFileToDirectory?.(directory, new Blob(['video']), '../escape.mp4'), /文件名/);
});
