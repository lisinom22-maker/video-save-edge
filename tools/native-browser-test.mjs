import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readOutput } from './output-test-utils.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const video = await readFile(path.join(root, '.test/video.mp4'));
const downloads = path.join(root, '.test/native-downloads-' + Date.now());
await mkdir(downloads, { recursive: true });
const profile = path.join(root, '.test/native-profile-' + Date.now());
await mkdir(path.join(profile, 'Default'), { recursive: true });
await writeFile(path.join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><video title="First download" src="/clip.mp4" style="width:640px;height:360px"></video>'); }
  else { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length }); res.end(video); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.TEST_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [...(process.env.TEST_BROWSER_EXECUTABLE ? ["--enable-unsafe-extension-debugging"] : []), `--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`] });
  await context.addInitScript(() => { window.showDirectoryPicker = undefined; });
  let extensionID;
  if (process.env.TEST_BROWSER_EXECUTABLE) {
    const loaded = await (await context.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: path.join(root, 'extension') });
    extensionID = loaded.id;
  }
  if (!extensionID) {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 12000 });
    extensionID = new URL(worker.url()).host;
  }
  const source = await context.newPage(); await source.goto(`http://127.0.0.1:${server.address().port}/`);
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionID}/manager.html`);
  const tabId = await panel.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, source.url());
  await panel.goto(`chrome-extension://${extensionID}/manager.html?tab=${tabId}`);
  await (await context.newCDPSession(panel)).send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  await panel.locator('#account').filter({ hasText: '直接保存' }).waitFor();
  assert.equal(await panel.locator('#download').isEnabled(), true, 'First download must allow choosing a folder instead of disabling the button');
  await panel.locator('#download').click();
  await panel.getByText('文件已保存', { exact: true }).waitFor();
  const savedPath = await panel.locator('#status-detail').textContent();
  assert.ok(savedPath.startsWith(downloads), JSON.stringify({ savedPath, downloads }));
  assert.deepEqual(await readFile(savedPath), video);
  const blobSaved = await panel.evaluate(async () => {
    const { nativeSave } = await import('./native-output.mjs');
    return nativeSave(new Blob([new Uint8Array([1, 2, 3, 4])]), 'Merged sample.mp4');
  });
  assert.deepEqual([...await readFile(blobSaved.relativePath)], [1, 2, 3, 4]);
  assert.ok((await panel.locator('#task-foot').innerText()).includes('下载记录'));
  console.log('PASS: browser-native fallback saves actual video bytes and waits for download completion');
} finally { await context?.close(); await new Promise(resolve => server.close(resolve)); }
