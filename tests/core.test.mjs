import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as core from '../extension/core.mjs';

test('视频地址仅接受B站普通视频，并保留分P', () => {
  assert.deepEqual(core.parseVideoURL('https://www.bilibili.com/video/BV1xx411c7mD/?p=2'), { bvid: 'BV1xx411c7mD', page: 2 });
  assert.deepEqual(core.parseVideoURL('https://www.bilibili.com/video/av170001/'), { aid: '170001', page: 1 });
  for (const url of ['https://bilibili.com.evil.test/video/BV1xx411c7mD', 'javascript:alert(1)', 'https://www.bilibili.com/bangumi/play/ep1']) {
    assert.throws(() => core.parseVideoURL(url));
  }
});

test('MD5与WBI签名正确处理中文、编码和过滤字符', () => {
  assert.equal(core.md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(core.md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  const text = '中文 + 画质🎬';
  assert.equal(core.md5(text), createHash('md5').update(text).digest('hex'));
  const query = 'bvid=BV1xx411c7mD&name=%E4%B8%AD%20%E6%96%87&qn=80&wts=1700000000';
  const expected = createHash('md5').update(query + 'key').digest('hex');
  assert.equal(core.signWbi({ qn: 80, name: "中 文!'()*", bvid: 'BV1xx411c7mD' }, 'key', 1700000000), query + '&w_rid=' + expected);
});

const stream = (id, codecs = 'avc1.640028', more = {}) => ({ id, codecs, mimeType: 'video/mp4', baseUrl: `https://upos-test.bilivideo.com/${id}.m4s`, bandwidth: 1000000, width: 1920, height: 1080, ...more });
const audio = { id: 30280, codecs: 'mp4a.40.2', mimeType: 'audio/mp4', base_url: 'https://upos-test.bilivideo.com/audio.m4s', bandwidth: 192000 };

test('保留播放器提供的Akamai首选节点，不能只留下会返回567的备用节点', () => {
  const primary = 'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/video.m4s?hdnts=signed-original';
  const backup = 'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/video.m4s?upsig=original';
  const data = core.normalizePlayInfo({ dash: { video: [stream(80, 'avc1.640028', { baseUrl: primary, backupUrl: [backup] })], audio: [audio] } });
  assert.equal(data.videos[0].url, primary);
  assert.deepEqual(data.videos[0].urls, [primary, backup]);
  assert.equal(core.isMediaURL('https://unrelated.akamaized.net/video.m4s'), false);
  assert.equal(core.isMediaURL('https://upos-hz-mirrorakam.akamaized.net.evil.test/video.m4s'), false);
});

test('从DASH中列出真实可用画质，默认兼容编码并选择AAC音轨', () => {
  const result = core.normalizePlayInfo({ dash: { video: [stream(125, 'hev1.1'), stream(80, 'hev1.1'), stream(80), stream(64)], audio: [audio] }, accept_quality: [120, 80, 64], support_formats: [{ quality: 80, new_description: '1080P 高清' }] });
  assert.equal(result.videos.length, 4);
  assert.equal(result.videos[result.defaultIndex].codecs, 'avc1.640028');
  assert.equal(result.videos[result.defaultIndex].quality, 80);
  assert.equal(result.audio.url, 'https://upos-test.bilivideo.com/audio.m4s');
  assert.equal(result.videos.some(v => v.quality === 120), false);
});

test('拒绝预览、受保护和外部伪造流地址', () => {
  assert.throws(() => core.normalizePlayInfo({ is_preview: 1, dash: { video: [stream(80)], audio: [audio] } }), /试看/);
  assert.throws(() => core.normalizePlayInfo({ is_drm: true, dash: { video: [stream(80)], audio: [audio] } }), /保护/);
  assert.throws(() => core.normalizePlayInfo({ dash: { video: [stream(80, 'avc1', { baseUrl: 'https://evil.test/a' })], audio: [audio] } }), /资源/);
  assert.equal(core.isMediaURL('https://bilivideo.com.evil.test/a'), false);
  assert.equal(core.isMediaURL('http://upos.bilivideo.com/a'), false);
  assert.equal(core.isMediaURL('https://upos.bilivideo.cn/a'), true);
});

test('允许单文件MP4，拒绝把多段FLV拼成损坏的MP4', () => {
  const direct = core.normalizePlayInfo({ quality: 64, format: 'mp4', durl: [{ url: 'https://upos-test.bilivideo.com/video.mp4', size: 100 }] });
  assert.equal(direct.direct.url, 'https://upos-test.bilivideo.com/video.mp4');
  assert.throws(() => core.normalizePlayInfo({ format: 'flv', durl: [{ url: 'https://upos-test.bilivideo.com/a.flv' }, { url: 'https://upos-test.bilivideo.com/b.flv' }] }), /格式/);
});

test('清理Windows非法文件名和保留名，限制长度并保留扩展名', () => {
  assert.equal(core.safeFilename('CON', '.mp4'), '_CON.mp4');
  assert.equal(core.safeFilename('测试:/视频. ', '.mp4'), '测试__视频.mp4');
  assert.equal(core.safeFilename('../a\\b', '.m4a'), '_a_b.m4a');
  assert.ok(core.safeFilename('长'.repeat(200), '.mp4').length <= 124);
});

test('多分P元信息依据用户选择的cid，防止下载错P', () => {
  const data = { bvid: 'BV1xx411c7mD', aid: 170001, title: '视频', pic: 'https://i0.hdslb.com/a.jpg', owner: { name: 'UP' }, pages: [{ cid: 11, page: 1, part: '上', duration: 4 }, { cid: 22, page: 2, part: '下', duration: 5 }] };
  const meta = core.normalizeVideoInfo(data, 2);
  assert.equal(meta.selectedCid, 22);
  assert.equal(meta.pages.length, 2);
  assert.equal(core.normalizeVideoInfo(data, 99).selectedCid, 11);
});
