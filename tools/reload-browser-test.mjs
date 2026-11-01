import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { configureOutput, listOutput } from './output-test-utils.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const video = await readFile(path.join(root, '.test/video.mp4'));
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body><video title="Before reload" src="/clip.mp4" style="width:640px;height:360px"></video></body></html>'); }
  else { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length }); res.end(video); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  context = await chromium.launchPersistentContext(path.join(root, '.test/reload-profile-' + Date.now()), { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`] });
  context.setDefaultTimeout(10000);
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  let output = await configureOutput(context, id);
  const source = await context.newPage();
  const errors = []; source.on('pageerror', e => errors.push(e.message));
  await source.goto(`http://127.0.0.1:${server.address().port}/`);
  async function download(name) {
    await source.bringToFront(); await source.locator('video').hover(); await source.keyboard.press('Control+c');
    await source.locator('.vs-quick-toast[data-state="success"]').waitFor({ timeout: 10000 }).catch(async error => {
      console.log('SHORTCUT DIAGNOSTIC', JSON.stringify({ errors, toast: await source.locator('.vs-quick-toast').textContent().catch(() => null), tasks: context.pages().map(p => p.url()) })); throw error;
    });
    const files = await listOutput(output);
    assert.ok(files.includes(name + '.mp4'), 'Expected ' + name + '.mp4; got ' + files.join(', '));
  }
  await download('Before reload');
  console.log('PASS: fresh page Ctrl+C downloads');
  const management = await context.newPage();
  await management.goto('edge://extensions/');
  await management.waitForTimeout(1500);
  await management.locator('extension-card fluent-button').filter({ hasText: /重新加载|Reload/ }).click();
  await new Promise(resolve => setTimeout(resolve, 750));
  output = await context.newPage();
  await output.goto(`chrome-extension://${id}/manager.html`);
  await output.getByText('Videos/VideoDownloads', { exact: true }).waitFor();
  const connections = await output.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
    return Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'vs-quick-ping' })));
  });
  assert.ok(connections.length && connections.every(result => result.ready));
  await source.locator('video').evaluate(v => v.title = 'After reload');
  await download('After reload');
  console.log('PASS: existing webpage Ctrl+C still downloads after extension reload without refreshing page');
} finally { await context?.close(); await new Promise(resolve => server.close(resolve)); }
