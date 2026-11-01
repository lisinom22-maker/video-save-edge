import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export async function configureOutput(context, extensionID) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionID}/manager.html`);
  await page.getByRole('button', { name: '选择视频文件夹', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.showDirectoryPicker), 'function', 'The extension origin must support the native folder picker');
  // The browser's actual directory/IDB APIs are exercised with an isolated OPFS
  // directory. Only the OS picker is replaced; no user directory is granted.
  await page.evaluate(() => { window.showDirectoryPicker = async options => { window.__pickerStart = options.startIn; const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle('Videos', { create: true }); }; });
  await page.getByRole('button', { name: '选择视频文件夹', exact: true }).click();
  await page.getByText('Videos/VideoDownloads', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__pickerStart), 'videos');
  await page.reload();
  await page.getByText('Videos/VideoDownloads', { exact: true }).waitFor();
  return page;
}
export async function readOutput(page, filename) {
  return page.evaluate(async filename => {
    const { selectedDirectory } = await import('./output.mjs');
    const root = await selectedDirectory();
    const directory = root.name === 'VideoDownloads' ? root : await root.getDirectoryHandle('VideoDownloads');
    const file = await (await directory.getFileHandle(filename)).getFile();
    return { filename: file.name, size: file.size, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) };
  }, filename);
}
export async function listOutput(page) {
  return page.evaluate(async () => {
    const { selectedDirectory } = await import('./output.mjs');
    const root = await selectedDirectory();
    const directory = root.name === 'VideoDownloads' ? root : await root.getDirectoryHandle('VideoDownloads', { create: true });
    const files = []; for await (const [name, entry] of directory.entries()) if (entry.kind === 'file') files.push(name);
    return files;
  });
}
export async function saveLastOutput(page, nodePath) {
  const label = await page.locator('#status-detail').textContent();
  const filename = label.split('/').pop();
  const file = await readOutput(page, filename);
  await writeFile(nodePath, Buffer.from(file.bytes));
  return file;
}
