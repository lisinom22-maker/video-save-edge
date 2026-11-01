import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readOutput } from './output-test-utils.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const video = await readFile(path.join(root, '.test/video.mp4'));
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><video title="First download" src="/clip.mp4" style="width:640px;height:360px"></video>'); }
  else { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length }); res.end(video); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  context = await chromium.launchPersistentContext(path.join(root, '.test/first-download-' + Date.now()), { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const source = await context.newPage(); await source.goto(`http://127.0.0.1:${server.address().port}/`);
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${new URL(worker.url()).host}/manager.html`);
  const tabId = await panel.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, source.url());
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/manager.html?tab=${tabId}`);
  await panel.locator('#account').filter({ hasText: '直接保存' }).waitFor();
  assert.equal(await panel.locator('#download').isEnabled(), true, 'First download must allow choosing a folder instead of disabling the button');
  await panel.evaluate(() => { window.showDirectoryPicker = async options => { window.__pickerCalls = (window.__pickerCalls || 0) + 1; window.__pickerStart = options.startIn; window.__pickerActive = navigator.userActivation.isActive; if (window.__cancelPicker) throw new DOMException('Cancelled', 'AbortError'); return (await navigator.storage.getDirectory()).getDirectoryHandle('Videos', { create: true }); }; window.__cancelPicker = true; });
  await panel.locator('#download').click();
  await panel.waitForFunction(() => window.__pickerCalls === 1);
  assert.equal(await panel.locator('#download').isEnabled(), true, 'Cancelling picker must allow retry');
  await panel.evaluate(() => window.__cancelPicker = false);
  await panel.locator('#download').click();
  await panel.getByText('文件已保存', { exact: true }).waitFor();
  assert.equal(await panel.evaluate(() => window.__pickerStart), 'videos');
  assert.equal(await panel.evaluate(() => window.__pickerActive), true, 'Picker must run inside the trusted download click');
  assert.deepEqual(Buffer.from((await readOutput(panel, 'First download.mp4')).bytes), video);
  assert.equal(await panel.evaluate(() => window.__pickerCalls), 2);
  console.log('PASS: first download enabled, picker cancel/retry, trusted folder selection and real video bytes saved');
} finally { await context?.close(); await new Promise(resolve => server.close(resolve)); }
