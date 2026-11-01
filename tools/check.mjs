import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const ext = path.join(root, 'extension');
const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.ok(!manifest.host_permissions.includes('<all_urls>'));
for (const file of ['manager.html', 'manager.css', 'manager.mjs', manifest.background.service_worker, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(c => c.js), 'vendor/ffmpeg/LICENSE', 'vendor/core/LICENSE']) await stat(path.join(ext, file));
async function walk(folder) {
  const out = [];
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, item.name);
    out.push(...(item.isDirectory() ? await walk(full) : [full]));
  }
  return out;
}
const files = await walk(ext);
for (const file of files.filter(f => /\.(?:m?js)$/.test(f))) execFileSync(process.execPath, ['--check', file]);
const html = await readFile(path.join(ext, 'manager.html'), 'utf8');
assert.ok(!/\son[a-z]+\s*=|<script\b[^>]*src=["']https?:/i.test(html), 'No inline handlers or remotely hosted script');
const wasm = await readFile(path.join(ext, 'vendor/core/ffmpeg-core.wasm'));
assert.equal(wasm.subarray(0, 4).toString('hex'), '0061736d');
assert.ok(wasm.length > 20_000_000);
const lock = JSON.parse(await readFile(path.join(ext, 'vendor-lock.json'), 'utf8'));
for (const item of lock) assert.equal(createHash('sha256').update(await readFile(path.join(ext, item.file))).digest('hex'), item.bundledSHA256, item.file + ' integrity');
for (const name of ['vendor/ffmpeg/ffmpeg.js', 'vendor/ffmpeg/814.ffmpeg.js']) assert.ok(!/https:\/\/unpkg|file:\/\/\/Users\//.test(await readFile(path.join(ext, name), 'utf8')));
console.log(`PASS: MV3 manifest, ${files.length} extension files, JavaScript syntax, local WASM, CSP boundaries and SHA-256 vendor integrity.`);
