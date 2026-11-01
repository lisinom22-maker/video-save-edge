import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { configureOutput, readOutput, listOutput } from './output-test-utils.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const mp4 = await readFile(path.join(root, '.test/video.mp4'));
const webm = await readFile(path.join(root, '.test/video.webm'));
const downloads = path.join(root, '.test/quick-native-' + Date.now());
await mkdir(downloads, { recursive: true });
const profile = path.join(root, '.test/quick-profile-' + Date.now());
await mkdir(path.join(profile, 'Default'), { recursive: true });
const preferencesPath = path.join(profile, 'Default/Preferences');
const preferences = JSON.parse(await readFile(preferencesPath, 'utf8').catch(() => '{}'));
preferences.download = { ...preferences.download, default_directory: downloads, prompt_for_download: false, directory_upgrade: true };
await writeFile(preferencesPath, JSON.stringify(preferences));
const requests = [];
let slowFrame = false;
const html = port => `<!doctype html><html><head><title>Simple Video Test</title><style>body{font-family:sans-serif;margin:30px}video{display:block;width:320px;height:180px;background:#ddd}.player{position:relative;width:320px;height:180px}.overlay{position:absolute;inset:0}.row{display:flex;gap:30px}iframe{width:360px;height:240px;border:1px solid #ccc}</style></head><body><h1>Video shortcut fixture</h1><input id="input" value="normal text"><p id="text">Text to copy normally</p><div class="row"><video id="first" title="First clip" preload="metadata" src="/first.mp4"></video><div class="player"><video id="second" title="Second clip" preload="metadata"><source src="/second.webm" type="video/webm"></video><div class="overlay"></div></div><video id="blob" title="Blob clip" type="video/mp4"></video></div><div id="shadow"></div><iframe id="frame" src="http://localhost:${port}/frame"></iframe><script>fetch('/blob.mp4').then(r=>r.blob()).then(b=>document.querySelector('#blob').src=URL.createObjectURL(b));const s=document.querySelector('#shadow').attachShadow({mode:'open'});s.innerHTML='<video title="Shadow clip" src="/shadow.mp4" preload="metadata" style="width:320px;height:180px;display:block"></video>';</script></body></html>`;
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html(server.address().port).replace('</body>', (process.env.PUBLIC_VIDEO === '1' ? '<video id="public" title="Public MDN sample" preload="none" src="https://developer.mozilla.org/shared-assets/videos/flower.mp4"></video>' : '') + '</body>')); }
  else if (req.url === '/frame') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><title>frame</title></head><body><video title="Frame clip" src="/frame.mp4" preload="metadata" style="display:block;width:320px;height:180px"></video></body></html>'); }
  else {
    requests.push({ url: req.url, range: req.headers.range });
    const data = req.url.endsWith('.webm') ? webm : mp4;
    const match = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    res.setHeader('Content-Type', req.url.endsWith('.webm') ? 'video/webm' : 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (match) { const begin = Number(match[1]), end = Math.min(data.length - 1, match[2] ? Number(match[2]) : data.length - 1); res.writeHead(206, { 'Content-Range': `bytes ${begin}-${end}/${data.length}`, 'Content-Length': end - begin + 1 }); res.end(data.subarray(begin, end + 1)); }
    else { res.setHeader('Content-Length', data.length); if (slowFrame && req.url === '/frame.mp4') { res.write(data.subarray(0, 100)); const timer = setTimeout(() => res.end(data.subarray(100)), 10000); res.on('close', () => clearTimeout(timer)); } else res.end(data); }
  }
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const context = await chromium.launchPersistentContext(profile, { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`, '--no-first-run'] });
try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const output = await configureOutput(context, new URL(sw.url()).host);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#first').waitFor();
  async function completed(title, extension) {
    let item;
    const deadline = Date.now() + 15000;
    while (!item && Date.now() < deadline) {
      item = await readOutput(output, title + extension).catch(() => null);
      if (item && !item.size) item = null;
      if (!item) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!item) console.log('OUTPUT STATE', JSON.stringify({ files: await listOutput(output), session: await sw.evaluate(async () => chrome.storage.session.get(null)) }));
    assert.ok(item, 'Video must finish in the selected Videos/VideoDownloads directory: ' + title);
    return item;
  }
  await page.locator('#first').hover(); await page.keyboard.press('Control+c');
  const first = await completed('First clip', '.mp4');
  assert.deepEqual(Buffer.from(first.bytes), mp4);
  await page.locator('.overlay').hover(); await page.keyboard.press('Control+c');
  const second = await completed('Second clip', '.webm'); assert.deepEqual(Buffer.from(second.bytes), webm);
  // Input and selection copy must not trigger any extra download.
  const before = (await listOutput(output)).length;
  await page.locator('#input').focus(); await page.keyboard.press('Control+c');
  await page.locator('#text').evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  await page.locator('#first').hover(); await page.keyboard.press('Control+c');
  await page.waitForTimeout(250);
  assert.equal((await listOutput(output)).length, before);
  await page.evaluate(() => { getSelection().removeAllRanges(); document.activeElement?.blur(); });
  await page.locator('#shadow video').hover(); await page.keyboard.press('Control+c'); await completed('Shadow clip', '.mp4');
  await page.waitForFunction(() => document.querySelector('#blob').currentSrc.startsWith('blob:'));
  await page.locator('#blob').hover(); await page.keyboard.press('Control+c'); await completed('Blob clip', '.mp4');
  await page.frameLocator('#frame').locator('video').hover();
  await page.keyboard.press('Control+c'); await completed('Frame clip', '.mp4');
  // Root-frame feedback must be able to cancel its cross-origin iframe download.
  slowFrame = true;
  await page.reload();
  await page.frameLocator('#frame').locator('video').hover();
  await page.keyboard.press('Control+c');
  await page.locator('.vs-quick-toast[data-state="pending"] button').waitFor();
  await page.locator('.vs-quick-toast[data-state="pending"] button').click();
  await page.waitForFunction(() => document.querySelector('.vs-quick-toast')?.textContent.includes('已取消'), null, { timeout: 6000 });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(!(await listOutput(output)).some(name => name.startsWith('Frame clip (')), 'Cancellation must not leave an empty placeholder');
  const report = { passed: ['Ctrl+C first video', 'overlay exact second video WebM', 'copy in input', 'text selection copy', 'open shadow root', 'video Blob background task', 'iframe hover', 'selected Videos/VideoDownloads folder', 'iframe cancel from parent toast'], first: first.filename, second: second.filename };
  if (process.env.PUBLIC_VIDEO === '1') {
    await page.locator('#public').hover(); await page.keyboard.press('Control+c');
    const sample = await completed('Public MDN sample', '.mp4');
    const data = Buffer.from(sample.bytes);
    assert.equal(data.subarray(4, 8).toString(), 'ftyp');
    assert.ok(data.length > 10000);
    report.passed.push('live public MDN MP4 downloaded via Ctrl+C');
    report.publicVideo = { filename: sample.filename, bytes: data.length };
  }
  const sourceTabId = await sw.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, page.url());
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${new URL(sw.url()).host}/manager.html?tab=${sourceTabId}`);
  await manager.getByRole('heading', { name: 'First clip', exact: true }).waitFor();
  await manager.getByLabel('页面中的视频', { exact: true }).selectOption('2');
  await manager.getByRole('heading', { name: 'Second clip', exact: true }).waitFor();
  await manager.waitForFunction(() => !document.querySelector('#download').disabled);
  await manager.getByRole('button', { name: '下载视频', exact: true }).click();
  await manager.getByText('文件已保存', { exact: true }).waitFor();
  report.passed.push('generic manual panel selects exact second WebM');
  await page.screenshot({ path: path.join(root, '.test/quick.png'), fullPage: true });
  await writeFile(path.join(root, '.test/quick-report.json'), JSON.stringify(report, null, 2));
  console.log('PASS: ' + report.passed.length + ' real Edge shortcut scenarios and selected-directory writes.');
} catch (error) {
  const pages = context.pages();
  console.log('DIAGNOSTIC', JSON.stringify({ pages: await Promise.all(pages.map(async p => ({ url: p.url(), text: (await p.locator('body').innerText().catch(() => '')).slice(-1600) }))) }));
  const worker = context.serviceWorkers()[0];
  if (worker) console.log('JOBS', JSON.stringify(await worker.evaluate(async () => chrome.storage.session.get(null))));
  throw error;
} finally { await context.close(); await new Promise(resolve => server.close(resolve)); }
