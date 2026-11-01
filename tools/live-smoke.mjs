// Read-only smoke check in a fresh Edge profile; never touches the user's profile.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
await mkdir(path.join(root, '.test'), { recursive: true });
const context = await chromium.launchPersistentContext(path.join(root, '.test/live-profile'), { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`, '--no-first-run'], viewport: { width: 1280, height: 950 } });
const report = { checkedAt: new Date().toISOString(), loggedIn: false, downloaded: false };
try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const page = await context.newPage();
  const response = await page.goto('https://www.bilibili.com/video/BV17x411w7KC/', { waitUntil: 'domcontentloaded', timeout: 25000 });
  report.pageStatus = response?.status();
  report.title = await page.title();
  report.api = await page.evaluate(async () => {
    try {
      const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=BV17x411w7KC', { credentials: 'include', signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      return { status: r.status, bodyPrefix: text.slice(0, 180) };
    } catch (error) { return { error: error.message }; }
  });
  const tabID = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' }))[0].id);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${new URL(sw.url()).host}/manager.html?tab=${tabID}`);
  await manager.waitForFunction(() => document.querySelector('#error')?.hidden === false || document.querySelector('#download')?.disabled === false, null, { timeout: 25000 });
  report.manager = await manager.locator('#workspace').innerText();
  report.canDownload = await manager.locator('#download').isEnabled();
  await manager.screenshot({ path: path.join(root, '.test/live.png'), fullPage: true });
} catch (error) { report.error = error.message; }
finally { await writeFile(path.join(root, '.test/live-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await context.close(); }
