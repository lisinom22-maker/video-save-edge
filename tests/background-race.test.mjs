import test from 'node:test';
import assert from 'node:assert/strict';

test('创建详情页中途取消，旧任务快照也不能遗留插件创建的后台页', async () => {
  const data = {};
  let listener, createResolve, updateResolve, updateStarted;
  let pauseNextRead = false, releaseRead;
  const removed = [];
  const updated = new Promise(resolve => { updateStarted = resolve; });
  const clone = value => structuredClone(value);
  globalThis.chrome = {
    storage: { session: {
      async get(name) {
        const snapshot = name === null ? clone(data) : { [name]: clone(data[name]) };
        if (pauseNextRead) { pauseNextRead = false; return new Promise(resolve => { releaseRead = () => resolve(snapshot); }); }
        return snapshot;
      },
      async set(values) { Object.assign(data, clone(values)); },
      async remove(name) { delete data[name]; }
    } },
    tabs: {
      onRemoved: { addListener() {} },
      async sendMessage(tab, message) { if (message.type === 'vs-quick-describe') return { ok: true, target: { token: 'cover', kind: 'page', url: 'https://www.bilibili.com/video/BV1Rbxg6WER5/', pageURL: 'https://www.bilibili.com/', hasImage: true } }; return { ok: true }; },
      create() { return new Promise(resolve => { createResolve = resolve; }); },
      update() { updateStarted(); return new Promise(resolve => { updateResolve = resolve; }); },
      async get() { return { url: 'https://www.bilibili.com/video/BV1Rbxg6WER5/', status: 'complete' }; },
      async remove(id) { removed.push(id); }
    },
    runtime: { id: 'test-extension', getURL: file => 'chrome-extension://test-extension/' + file, onMessage: { addListener(fn) { listener = fn; } } }
  };
  await import('../extension/quick-background.mjs?cancel-race');
  const sender = { id: 'test-extension', tab: { id: 1 }, frameId: 0, documentId: 'root-doc', url: 'https://www.bilibili.com/' };
  const send = message => new Promise(resolve => listener(message, sender, resolve));
  const accepted = await send({ type: 'vs-quick-start', token: 'cover' });
  assert.equal(accepted.ok, true);
  pauseNextRead = true;
  const cancelling = send({ type: 'vs-quick-cancel', jobId: accepted.jobId });
  await new Promise(resolve => setTimeout(resolve, 0));
  createResolve({ id: 99 });
  await updated;
  releaseRead();
  assert.equal((await cancelling).ok, true);
  updateResolve({ id: 99 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(removed.includes(99), 'The owned resolver tab must be closed despite the stale cancel snapshot');
  assert.equal(Object.keys(data).filter(k => k.startsWith('vs-job:')).length, 0);
});
