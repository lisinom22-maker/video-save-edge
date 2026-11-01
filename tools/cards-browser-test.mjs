import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { configureOutput, readOutput, listOutput } from './output-test-utils.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const mp4 = await readFile(path.join(root, '.test/video.mp4'));
const webm = await readFile(path.join(root, '.test/video.webm'));
const audio = await readFile(path.join(root, '.test/audio.m4a'));
const icon = await readFile(path.join(root, 'extension/icons/128.png'));
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><head><title>未打开的视频封面</title><style>a{display:inline-block;padding:20px;cursor:pointer}img{width:120px;height:90px}body{font:16px sans-serif}</style></head><body><a id="direct" href="/direct.mp4" title="Cover direct"><img src="/cover.png" alt="视频文件封面"></a><a id="detail" href="/watch/42"><img src="/cover.png" alt="详情视频封面"></a><a id="bili" href="https://www.bilibili.com/video/BV1Rbxg6WER5/?p=2"><img src="/cover.png" alt="B站尚未打开的封面"></a><a id="slow" href="/watch/slow"><img src="/cover.png" alt="加载中取消测试"></a><a id="ordinary" href="/about"><img src="/cover.png" alt="普通介绍页面"></a></body></html>'); }
  else if (req.url.startsWith('/watch/')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><head><title>Video detail</title></head><body><video title="Small preview" src="/preview.mp4" style="display:block;width:160px;height:90px"></video><main id="player"></main><script>setTimeout(()=>{document.querySelector("#player").innerHTML=\'<video title="Card detail clip" src="/detail.webm" style="display:block;width:640px;height:360px"></video>\'},' + (req.url.includes('slow') ? 10000 : 450) + ')</script></body></html>'); }
  else { const data = req.url.endsWith('png') ? icon : req.url.endsWith('webm') ? webm : mp4; res.writeHead(200, { 'Content-Type': req.url.endsWith('png') ? 'image/png' : req.url.endsWith('webm') ? 'video/webm' : 'video/mp4', 'Content-Length': data.length }); res.end(data); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const context = await chromium.launchPersistentContext(path.join(root, '.test/cards-profile-' + Date.now()), { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, viewport: { width: 1440, height: 950 }, args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`, '--no-first-run'] });
try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const output = await configureOutput(context, new URL(sw.url()).host);
  const biliMeta = { bvid: 'BV1Rbxg6WER5', aid: 1, title: 'Bili unopened cover', cid: 22, owner: { name: 'test' }, pages: [{ cid: 11, page: 1, part: 'First', duration: 2 }, { cid: 22, page: 2, part: 'Second', duration: 2 }] };
  const play = { data: { dash: { video: [{ id: 80, codecs: 'avc1.64001e', mimeType: 'video/mp4', baseUrl: 'https://test.bilivideo.com/video.mp4' }], audio: [{ id: 30280, codecs: 'mp4a.40.2', mimeType: 'audio/mp4', baseUrl: 'https://test.bilivideo.com/audio.m4a' }] } } };
  await context.route('https://www.bilibili.com/video/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><head><meta charset="UTF-8"><title>Bili detail</title><script>window.__INITIAL_STATE__=${JSON.stringify({ videoData: biliMeta, cid: 22 })};window.__playinfo__=${JSON.stringify(play)}</script></head><body><video style="width:640px;height:360px"></video></body></html>` }));
  await context.route('https://api.bilibili.com/**', r => r.fulfill({ status: 412, headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' }, body: 'Blocked' }));
  await context.route('https://test.bilivideo.com/**', r => { const bytes = r.request().url().endsWith('audio.m4a') ? audio : mp4; return r.fulfill({ contentType: 'video/mp4', headers: { 'access-control-allow-origin': '*', 'content-length': String(bytes.length) }, body: bytes }); });
  const page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);
  await page.bringToFront();
  assert.equal(await page.locator('video').count(), 0, 'The source page must contain only unopened covers, no player');
  assert.equal(await page.locator('#direct').evaluate(e => getComputedStyle(e).cursor), 'pointer');
  async function completed(filename) {
    const deadline = Date.now() + 20000; let saved;
    while (!saved && Date.now() < deadline) {
      const errorText = await page.evaluate(() => document.querySelector('.vs-quick-toast[data-state="error"]')?.textContent || null);
      if (errorText) throw new Error(errorText);
      saved = await readOutput(output, filename).catch(() => null); if (!saved || !saved.size) { saved = null; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(saved, 'Expected saved video: ' + filename);
    await page.locator('.vs-quick-toast[data-state="success"]').waitFor();
    assert.equal(page.url(), url, 'The user source page must not navigate');
    return saved;
  }
  await page.locator('#direct img').hover(); await page.keyboard.press('Control+c');
  assert.deepEqual(Buffer.from((await completed('Cover direct.mp4')).bytes), mp4);
  await page.bringToFront(); await page.locator('#detail img').hover(); await page.keyboard.press('Control+c');
  assert.deepEqual(Buffer.from((await completed('Card detail clip.webm')).bytes), webm);
  const tabs = await sw.evaluate(async () => (await chrome.tabs.query({})).map(t => t.url));
  assert.ok(!tabs.some(t => t?.endsWith('/watch/42')), 'Created detail tab must be removed after saving');
  await page.bringToFront(); await page.locator('#bili img').hover(); await page.keyboard.press('Control+c');
  const file = await completed('Bili unopened cover - P2 Second - BV1Rbxg6WER5 - 1080P.mp4');
  await writeFile(path.join(root, '.test/card-bili-output.mp4'), Buffer.from(file.bytes));
  await page.bringToFront(); await page.locator('#ordinary img').hover(); await page.keyboard.press('Control+c');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(page.url(), url);
  assert.ok(!(await sw.evaluate(async () => (await chrome.tabs.query({})).map(t => t.url))).some(t => t?.endsWith('/about')));
  await page.locator('#slow img').hover(); await page.keyboard.press('Control+c');
  await page.locator('.vs-quick-toast[data-state="pending"] button').click();
  await page.locator('.vs-quick-toast[data-state="error"]').waitFor();
  await new Promise(resolve => setTimeout(resolve, 300));
  const remaining = await sw.evaluate(async () => ({ jobs: Object.keys(await chrome.storage.session.get(null)).filter(k => k.startsWith('vs-job:')), urls: (await chrome.tabs.query({})).map(t => t.url) }));
  assert.equal(remaining.jobs.length, 0);
  assert.ok(!remaining.urls.some(t => t?.endsWith('/watch/slow')));
  await output.screenshot({ path: path.join(root, '.test/folder-setup.png'), fullPage: true });
  await writeFile(path.join(root, '.test/cards-report.json'), JSON.stringify({ passed: ['one-time folder picker startIn=videos', 'directory persists after reload', 'hand cursor unopened direct-file cover', 'unopened detail page with delayed player', 'wait for main video rather than early small preview', 'background detail cleanup', 'unopened Bili cover p=2 mux', 'ordinary navigation link ignored', 'cancel unresolved cover cleanup'], osFolderPermissionAutomated: false }, null, 2));
  console.log('PASS: 9 real Edge card/folder scenarios; original page never navigated; Bili P2 merged to selected directory.');
} catch (error) {
  console.log('DIAGNOSTIC', JSON.stringify(await Promise.all(context.pages().map(async p => ({ url: p.url(), text: (await p.locator('body').innerText().catch(() => '')).slice(-1500) })))));
  const inspector = context.pages().find(p => p.url().endsWith('/manager.html'));
  if (inspector) console.log('OUTPUT FILES', await listOutput(inspector));
  throw error;
} finally { await context.close(); await new Promise(resolve => server.close(resolve)); }
