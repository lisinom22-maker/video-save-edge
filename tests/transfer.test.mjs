import test from 'node:test';
import assert from 'node:assert/strict';
import * as transfer from '../extension/transfer.mjs';

test('分块流严格按序组装，拒绝重复与缺失分块', () => {
  const r = new transfer.ChunkReceiver(10);
  r.push(0, 'AQID');
  r.push(1, 'BAU=');
  assert.deepEqual([...r.finish(5)], [1, 2, 3, 4, 5]);
  const bad = new transfer.ChunkReceiver(10);
  assert.throws(() => bad.push(1, 'AQ=='), /顺序/);
  bad.push(0, 'AQ==');
  assert.throws(() => bad.push(0, 'AQ=='), /顺序/);
  assert.throws(() => bad.finish(9), /完整/);
});

test('无Content-Length时仍强制总字节上限，不保留超限分块', () => {
  const r = new transfer.ChunkReceiver(3);
  r.push(0, 'AQID');
  assert.throws(() => r.push(1, 'BA=='), /过大/);
  assert.equal(r.bytes, 3);
});

test('连接断开或取消时下载Promise结束，不永久等待', async () => {
  const listeners = new Set();
  const messages = new Set();
  const port = { onMessage: { addListener: f => messages.add(f), removeListener: f => messages.delete(f) }, onDisconnect: { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f) }, postMessage() {}, disconnect() { for (const f of listeners) f(); } };
  const controller = new AbortController();
  const pending = transfer.receiveStream(port, { urls: ['https://upos.bilivideo.com/a'], limit: 100 }, controller.signal);
  controller.abort();
  await assert.rejects(pending, /取消/);
  assert.equal(messages.size, 0);
});

test('不把长度不一致的部分下载提交为成功文件', async () => {
  let handler;
  const port = { onMessage: { addListener: f => { handler = f; }, removeListener() {} }, onDisconnect: { addListener() {}, removeListener() {} }, postMessage() {}, disconnect() {} };
  const pending = transfer.receiveStream(port, { urls: [], limit: 100 });
  handler({ type: 'chunk', index: 0, data: 'AQID' });
  handler({ type: 'end', bytes: 4 });
  await assert.rejects(pending, /完整/);
});
