import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/quick-rules.js';

test('Ctrl+C只在非输入状态且没有文字选区时触发下载，不处理重复按键或组合输入', () => {
  const r = globalThis.VideoQuickRules;
  const key = { key: 'c', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false };
  assert.equal(r?.isCopyShortcut(key, { editable: false, selectedText: '' }), true);
  for (const context of [{ editable: true }, { selectedText: '正在复制的文字' }]) assert.equal(r.isCopyShortcut(key, context), false);
  for (const extra of [{ repeat: true }, { shiftKey: true }, { altKey: true }, { isComposing: true }, { ctrlKey: false }, { key: 'x' }]) assert.equal(r.isCopyShortcut({ ...key, ...extra }, {}), false);
});

test('普通视频保留HTTP或HTTPS资源、拒绝危险协议、识别分片流而非伪装MP4', () => {
  const r = globalThis.VideoQuickRules;
  assert.deepEqual(r?.classifyMedia('https://cdn.example.test/v.mp4?token=one', 'https://example.test'), { kind: 'direct', url: 'https://cdn.example.test/v.mp4?token=one', extension: '.mp4' });
  assert.equal(r.classifyMedia('/v.webm', 'https://example.test/page').extension, '.webm');
  assert.equal(r.classifyMedia('http://localhost:8800/v.mp4', 'http://localhost:8800').kind, 'direct');
  assert.equal(r.classifyMedia('https://cdn.example.test/playlist.m3u8', 'https://example.test').kind, 'unsupported');
  assert.equal(r.classifyMedia('https://cdn.example.test/file.mpd', 'https://example.test').kind, 'unsupported');
  assert.equal(r.classifyMedia('blob:https://example.test/1234', 'https://example.test').kind, 'blob');
  for (const u of ['javascript:alert(1)', 'file:///C:/secret.mp4', 'https://name:pass@example.test/a.mp4', 'blob:https://other.test/1234']) assert.equal(r.classifyMedia(u, 'https://example.test').kind, 'unsupported');
});

test('所有成品文件写入同一子目录，文件名不能越过目录或改变扩展名', () => {
  const r = globalThis.VideoQuickRules;
  assert.equal(r?.downloadPath('测试:/视频', '.mp4'), 'VideoDownloads/测试__视频.mp4');
  assert.equal(r.downloadPath('../../CON', '.webm'), 'VideoDownloads/_CON.webm');
  assert.ok(r.downloadPath('a'.repeat(500), '.mp4').length <= 140);
  assert.equal(r.downloadPath('CON', '.mp4'), 'VideoDownloads/_CON.mp4');
  assert.throws(() => r.downloadPath('video', '.exe'));
});

test('未点开的视频封面可识别B站详情链接和视频文件链接，不把任意手形链接当视频', () => {
  const r = globalThis.VideoQuickRules;
  assert.deepEqual(r.classifyVideoLink?.('https://www.bilibili.com/video/BV1Rbxg6WER5/?p=2', 'https://www.bilibili.com'), { kind: 'page', url: 'https://www.bilibili.com/video/BV1Rbxg6WER5/?p=2' });
  assert.equal(r.classifyVideoLink('/clips/one.webm', 'https://example.test/').kind, 'direct');
  assert.equal(r.classifyVideoLink('/watch/123', 'https://example.test/', { hasImage: true }).kind, 'page');
  assert.equal(r.classifyVideoLink('/about', 'https://example.test/', { hasImage: true }), null);
  assert.equal(r.classifyVideoLink('javascript:alert(1)', 'https://example.test/'), null);
  assert.equal(r.classifyVideoLink('https://bilibili.com.evil.test/video/BV1Rbxg6WER5', 'https://example.test/'), null);
});
