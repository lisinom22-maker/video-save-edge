import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { configureOutput, saveLastOutput } from './output-test-utils.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const ext = path.join(root, 'extension');
const bundled = chromium.executablePath();
const executablePath = existsSync(bundled) ? bundled : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
await mkdir(path.join(root, '.test'), { recursive: true });
const context = await chromium.launchPersistentContext(path.join(root, '.test/profile-' + Date.now()), {
  executablePath, headless: true, acceptDownloads: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--no-default-browser-check'],
  viewport: { width: 1440, height: 1000 }
});
const errors = [];
context.on('weberror', error => errors.push(error.error().message));
try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionID = new URL(sw.url()).host;
  await configureOutput(context, extensionID);
  const video = await readFile(path.join(root, '.test/video.mp4'));
  const audio = await readFile(path.join(root, '.test/audio.m4a'));
  const meta = { bvid: 'BV1xx411c7mD', aid: 170001, title: '测试视频 · 浏览器内完整合并', pic: 'https://i0.hdslb.com/test.png', owner: { name: 'Bili Save 测试' }, pages: [{ cid: 11, page: 1, part: '第一集：完整视频', duration: 2 }, { cid: 22, page: 2, part: '第二集：分P测试', duration: 2 }] };
  let playCid = '';
  let loggedOut = false;
  let blockAPI = false;
  await context.route('https://www.bilibili.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><title>测试来源视频页</title><body><h1>Bili Save 集成测试来源页</h1></body></html>' }));
  await context.route('https://api.bilibili.com/**', route => {
    if (blockAPI) return route.fulfill({ status: 412, headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: 'Blocked' });
    const u = new URL(route.request().url());
    let data;
    if (u.pathname.endsWith('/view')) data = meta;
    else if (u.pathname.endsWith('/nav')) data = { isLogin: !loggedOut, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } };
    else {
      playCid = u.searchParams.get('cid');
      data = { dash: { video: [{ id: 80, codecs: 'avc1.64001e', mimeType: 'video/mp4', bandwidth: 200000, width: 320, height: 180, baseUrl: 'https://test.bilivideo.com/video.mp4' }], audio: [{ id: 30280, codecs: 'mp4a.40.2', mimeType: 'audio/mp4', bandwidth: 128000, baseUrl: 'https://test.bilivideo.com/audio.m4a' }] } };
    }
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: loggedOut && u.pathname.endsWith('/nav') ? -101 : 0, data }) });
  });
  await context.route('https://i0.hdslb.com/test.png', async route => route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: await readFile(path.join(ext, 'icons/128.png')) }));
  await context.route('https://test.bilivideo.com/**', route => {
    const data = route.request().url().endsWith('audio.m4a') ? audio : video;
    return route.fulfill({ contentType: 'video/mp4', headers: { 'access-control-allow-origin': '*', 'content-length': String(data.length) }, body: data });
  });
  const source = await context.newPage();
  await source.goto('https://www.bilibili.com/video/BV1xx411c7mD/?p=2');
  const tabID = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' }))[0].id);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionID}/manager.html?tab=${tabID}`);
  await page.getByRole('heading', { name: meta.title }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '下载 MP4', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#download').disabled);
  assert.equal(playCid, '22', 'initial p=2 must request cid=22');
  await page.getByLabel('分P').selectOption('11');
  await page.waitForFunction(() => !document.querySelector('#download').disabled);
  assert.equal(playCid, '11', 'changing P must request the selected cid');
  await page.getByRole('button', { name: '下载 MP4', exact: true }).click();
  await page.getByText('文件已保存', { exact: true }).waitFor({ timeout: 20000 });
  await saveLastOutput(page, path.join(root, '.test/output.mp4'));
  await page.screenshot({ path: path.join(root, '.test/ready.png'), fullPage: true });
  await page.getByRole('button', { name: '仅保存音频', exact: false }).click();
  await page.getByText('文件已保存', { exact: true }).waitFor();
  await saveLastOutput(page, path.join(root, '.test/output.m4a'));
  await page.getByRole('button', { name: '保存封面', exact: false }).click();
  await page.getByText('文件已保存', { exact: true }).waitFor();
  assert.ok((await saveLastOutput(page, path.join(root, '.test/cover.png'))).filename.endsWith('.png'));
  // A failed network request must finish as an error with a usable retry action.
  await context.unroute('https://test.bilivideo.com/**');
  await context.route('https://test.bilivideo.com/**', route => route.fulfill({ status: 403, headers: { 'access-control-allow-origin': '*' }, body: 'Denied' }));
  await page.getByRole('button', { name: '下载 MP4', exact: true }).click();
  await page.getByText(/HTTP 403/).waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole('button', { name: '重试下载', exact: true }).isEnabled(), true);
  // Escape cancels a pending transfer and unlocks the form.
  await context.unroute('https://test.bilivideo.com/**');
  await context.route('https://test.bilivideo.com/**', async route => { await new Promise(r => setTimeout(r, 2500)); await route.abort().catch(() => {}); });
  await page.getByRole('button', { name: '重试下载', exact: true }).click();
  await page.getByRole('button', { name: '取消下载', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: '已取消', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '下载 MP4', exact: true }).isEnabled(), true);
  // Reject oversized headers before buffering with a useful message.
  await context.unroute('https://test.bilivideo.com/**');
  await context.route('https://test.bilivideo.com/**', route => route.fulfill({ contentType: 'video/mp4', headers: { 'access-control-allow-origin': '*', 'content-length': '402653185' }, body: video }));
  await page.getByRole('button', { name: '下载 MP4', exact: true }).click();
  await page.getByText(/文件过大/).waitFor({ timeout: 5000 });
  // A logged-out nav response still supplies WBI keys for public qualities.
  loggedOut = true;
  await page.getByRole('button', { name: '重新识别', exact: false }).click();
  await page.waitForFunction(() => !document.querySelector('#download').disabled, null, { timeout: 5000 });
  await page.getByText('当前未登录 · 登录后可尝试更高清晰度', { exact: true }).waitFor();
  // Player state is a fallback when the site's API is temporarily blocked.
  blockAPI = true;
  await source.evaluate(info => {
    window.__INITIAL_STATE__ = { videoData: { ...info, title: '来自播放器的页面信息', cid: 22 }, cid: 22 };
    window.__playinfo__ = { data: { dash: { video: [{ id: 80, codecs: 'avc1.64001e', mimeType: 'video/mp4', baseUrl: 'https://test.bilivideo.com/video.mp4' }], audio: [{ id: 30280, codecs: 'mp4a.40.2', mimeType: 'audio/mp4', baseUrl: 'https://test.bilivideo.com/audio.m4a' }] } } };
  }, meta);
  await page.getByRole('button', { name: '重新识别', exact: false }).click();
  await page.getByRole('heading', { name: '来自播放器的页面信息' }).waitFor({ timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('#download').disabled, null, { timeout: 5000 });
  await page.getByText('已读取播放器当前可用资源', { exact: true }).waitFor();
  // Unsupported pages must give a clear recovery path.
  const empty = await context.newPage();
  await empty.goto(`chrome-extension://${extensionID}/manager.html`);
  await empty.getByText('先打开一个网页视频', { exact: true }).waitFor();
  await writeFile(path.join(root, '.test/browser-report.json'), JSON.stringify({ browser: executablePath, extensionID, passed: ['extension-load', 'metadata', 'part-switch', 'content-port-transfer', 'local-wasm-mux', 'download-complete', 'audio-only', 'cover', 'http-error-retry', 'cancel', 'oversized-header', 'logged-out-public-video', 'player-fallback', 'empty-state'], errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log('PASS: 14 extension integration scenarios; real MP4 and M4A saved to .test/');
} finally { await context.close(); }
