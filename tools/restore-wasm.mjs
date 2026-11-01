// Restore the large pinned runtime dependency when cloning the source repository.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(await readFile(path.join(root, 'extension/vendor-lock.json'), 'utf8'));
const asset = lock.find(item => item.file === 'vendor/core/ffmpeg-core.wasm');
if (!asset) throw new Error('Missing pinned WASM dependency.');
const target = path.join(root, 'extension', asset.file);
const hash = data => createHash('sha256').update(data).digest('hex');
let bytes = await readFile(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
if (!bytes || hash(bytes) !== asset.bundledSHA256) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Dependency server returned HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== asset.bundledSHA256) throw new Error('WASM integrity mismatch; no file was written.');
  await writeFile(target, bytes);
}
console.log('Verified pinned FFmpeg WASM. The extension is ready to load.');
