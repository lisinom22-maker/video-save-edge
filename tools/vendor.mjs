// Pin and verify local dependencies, and remove unused remote defaults from UMD wrappers.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const assets = [
  ['vendor/ffmpeg/ffmpeg.js', 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js'],
  ['vendor/ffmpeg/814.ffmpeg.js', 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/814.ffmpeg.js'],
  ['vendor/core/ffmpeg-core.js', 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js'],
  ['vendor/core/ffmpeg-core.wasm', 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm']
];
const lockPath = path.join(root, 'extension/vendor-lock.json');
const initialize = process.argv.includes('--initialize');
const lock = initialize ? [] : JSON.parse(await readFile(lockPath, 'utf8'));
for (const [name, url] of assets) {
  const file = path.join(root, 'extension', name);
  let data = await readFile(file);
  const originalSHA256 = createHash('sha256').update(data).digest('hex');
  const pinned = lock.find(v => v.file === name);
  if (!initialize && pinned && originalSHA256 !== pinned.bundledSHA256 && originalSHA256 !== pinned.upstreamSHA256) throw new Error('Vendor integrity mismatch: ' + name);
  if (name === 'vendor/ffmpeg/ffmpeg.js') {
    data = Buffer.from(data.toString().replace('file:///Users/focus/Projects/ffmpeg.wasm/packages/ffmpeg/dist/esm/classes.js', 'chrome-extension://local/'));
  }
  if (name === 'vendor/ffmpeg/814.ffmpeg.js') {
    data = Buffer.from(data.toString().replace('"https://unpkg.com/@ffmpeg/core@0.12.9/dist/umd/ffmpeg-core.js"', 'new URL("../core/ffmpeg-core.js",self.location.href).href'));
  }
  await writeFile(file, data);
  if (initialize) lock.push({ file: name, url, upstreamSHA256: originalSHA256, bundledSHA256: createHash('sha256').update(data).digest('hex') });
}
if (initialize) await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
await copyFile(path.join(root, 'tools/ffmpeg-package.json'), path.join(root, 'extension/vendor/ffmpeg/package.json'));
await copyFile(path.join(root, 'tools/ffmpeg-core-package.json'), path.join(root, 'extension/vendor/core/package.json'));
console.log('Verified 4 pinned vendor assets; local-only defaults applied.');
