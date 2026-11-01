import { MAX_BYTES, safeFilename } from './core.mjs';
import { inspectVideo, getPlayback } from './api.mjs';
import { receiveStream } from './transfer.mjs';
import { inspectGeneric, genericPlayback } from './generic.mjs';
import { chooseOutputDirectory, outputStatus, saveToSelectedDirectory } from './output.mjs';

const quickRules = globalThis.VideoQuickRules;
const params = new URL(location.href).searchParams;
const automatic = params.get('auto') === '1';
const quickJob = params.get('job');
const targetToken = params.get('token');
const targetFrame = Number(params.get('frame')) || 0;

const $ = id => document.getElementById(id);
const sourceTab = Number(new URL(location.href).searchParams.get('tab'));
let meta, playback, busy = false, loading = false, controller, ffmpeg;
let lastMode = 'video';
let loadVersion = 0;
let taskWasCancelled = false;
let folderAllowed = false;
let choosingFolder = false;
const controls = ['refresh', 'part', 'quality', 'download', 'audio', 'poster'];
const stage = document.querySelector('.task-card');
const formatBytes = n => n < 1048576 ? `${(n / 1024).toFixed(0)} KiB` : `${(n / 1048576).toFixed(1)} MiB`;
const formatTime = n => Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0');

function lock() {
  for (const id of controls) $(id).disabled = busy || loading || choosingFolder || !meta;
  $('download').disabled ||= !playback || (!playback.direct && (!playback.videos.length || !playback.audio));
  $('download').lastChild.textContent = folderAllowed ? (meta?.generic ? ' 下载视频' : ' 下载 MP4') : ' 选择文件夹并下载';
  $('choose-output').disabled = busy || choosingFolder;
  $('audio').disabled ||= !playback?.audio;
  $('poster').disabled ||= !meta?.cover;
  $('quality').disabled ||= !!playback?.direct || !playback?.videos?.length;
  $('cancel').hidden = !busy;
}
function task(state, title, detail, value) {
  stage.dataset.state = state;
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('task-tag').textContent = { idle: '准备就绪', downloading: '下载中', merging: '合并中', saving: '保存中', success: '已完成', error: '未完成', cancelled: '已取消' }[state] || '准备中';
  $('task-icon').textContent = { success: '✓', error: '!', cancelled: '−', merging: '⇄' }[state] || '↓';
  $('retry').hidden = state !== 'error';
  $('progress').hidden = ['idle', 'error', 'cancelled'].includes(state);
  $('task-foot').hidden = $('progress').hidden;
  if (typeof value === 'number') { $('progress').value = Math.min(1, Math.max(0, value)); $('progress-text').textContent = `${Math.round(value * 100)}%`; }
  else { $('progress').removeAttribute('value'); $('progress-text').textContent = '正在处理…'; }
  if (state === 'success') $('progress-text').textContent = '100% · 完成';
  document.querySelector('#task-foot > span:last-child').textContent = state === 'success' ? '文件直接写入所选文件夹，不显示在 Edge 下载记录中。可自行关闭此页。' : '下载时请保留来源视频页与此面板';
}
function displayError(error) { $('error').textContent = error.message || String(error); $('error').hidden = false; }
function clearError() { $('error').hidden = true; }
function setCover() {
  $('cover').hidden = true; $('cover-placeholder').hidden = false;
  if (!meta.cover) return;
  $('cover').onload = () => { $('cover').hidden = false; $('cover-placeholder').hidden = true; };
  $('cover').onerror = () => { $('cover').hidden = true; $('cover-placeholder').hidden = false; };
  $('cover').src = meta.cover;
}
function renderMeta() {
  $('video-title').textContent = meta.title;
  $('video-id').textContent = meta.bvid;
  $('owner').textContent = meta.owner;
  document.querySelector('.video-kicker > span:first-child').textContent = meta.generic ? 'WEB VIDEO' : 'BILIBILI';
  document.querySelector('label[for="part"]').textContent = meta.generic ? '页面中的视频' : '分P';
  document.querySelector('.cover-placeholder > span:last-child').textContent = meta.generic ? 'WEB VIDEO' : 'BILIBILI VIDEO';
  $('quality-note').textContent = meta.generic ? '直接保存网页提供的原始视频文件。此网站的分片流和受保护视频暂不支持。' : '仅列出当前账号可获取的画质，优先选择兼容性更好的 H.264。';
  const arrow = document.createElement('span'); arrow.textContent = '↓'; arrow.setAttribute('aria-hidden', 'true');
  $('download').replaceChildren(arrow, document.createTextNode(meta.generic ? ' 下载视频' : ' 下载 MP4'));
  document.querySelector('.download-hint small').textContent = meta.generic ? '保留原始格式，无需合并' : '原画质合并，无需重新编码';
  $('part').replaceChildren(...meta.pages.map(p => new Option(`P${p.page} · ${p.title}`, p.cid)));
  $('part').value = String(meta.selectedCid);
  setCover();
  updateDuration();
}
function updateDuration() {
  const p = meta.pages.find(p => p.cid === Number($('part').value));
  if (meta.generic && p) $('video-title').textContent = p.target.title;
  $('duration').hidden = !p?.duration;
  $('duration').textContent = p ? formatTime(p.duration) : '';
}
async function loadPlayback() {
  const version = ++loadVersion;
  const previous = playback?.videos[Number($('quality').value)];
  const cid = Number($('part').value);
  loading = true; playback = null; lock(); clearError();
  $('account').textContent = '正在读取当前分P的可用画质…'; $('account').className = 'account';
  try {
    const result = meta.generic ? genericPlayback(meta, cid) : await getPlayback(sourceTab, meta, cid);
    if (version !== loadVersion) return;
    playback = result;
    if (result.direct) $('quality').replaceChildren(new Option(`${result.direct.label}${result.generic ? '' : ' · 完整 MP4'}`, '0'));
    else {
      $('quality').replaceChildren(...result.videos.map((v, index) => new Option(`${v.label} · ${v.codecLabel}${[125,126].includes(v.quality) ? ' · 需相应显示设备' : ''}`, index)));
      const same = previous ? result.videos.findIndex(v => v.quality === previous.quality && v.codecs === previous.codecs) : -1;
      $('quality').value = String(same >= 0 ? same : result.defaultIndex);
    }
    $('account').textContent = result.generic ? '鼠标悬停视频后按 Ctrl+C，可直接保存到 VideoDownloads' : result.fromPlayer ? '已读取播放器当前可用资源' : result.loggedIn ? '已使用网页登录状态 · 仅显示可用画质' : '当前未登录 · 登录后可尝试更高清晰度';
    $('account').className = 'account' + (result.loggedIn ? ' ready' : '');
    if (!result.direct && !result.audio) throw new Error('当前资源缺少可用的 AAC 音轨，暂时无法生成带声音的 MP4。请刷新来源视频页后重试。');
  } catch (error) {
    if (version !== loadVersion) return;
    playback = null;
    $('quality').replaceChildren(new Option('暂未获取到资源', ''));
    $('account').textContent = '读取失败，可点击「重新识别」重试';
    displayError(error);
    await finishQuickTask('error', error.message);
  } finally { if (version === loadVersion) { loading = false; lock(); } }
}
async function refresh() {
  if (busy) return;
  loading = true; playback = null; lock(); clearError();
  try {
    await refreshOutput();
    const source = await chrome.tabs.get(sourceTab);
    const bili = /^https:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(?:BV[a-zA-Z0-9]{10}|av\d+)\/?(?:[?#]|$)/.test(source.url || '');
    meta = bili ? await inspectVideo(sourceTab) : await inspectGeneric(sourceTab, targetToken, targetFrame, params.get('discover') === '1');
    renderMeta();
    await loadPlayback();
  } catch (error) { displayError(error); $('video-title').textContent = '暂时无法识别视频'; await finishQuickTask('error', error.message); }
  finally { loading = false; lock(); $('refresh').disabled = false; }
  if (automatic && playback && !busy && !taskWasCancelled && folderAllowed) run('video');
}

async function refreshOutput() {
  const status = await outputStatus(); folderAllowed = status.allowed;
  $('output-path').textContent = status.label;
  $('choose-output').textContent = status.allowed ? '更换保存文件夹' : '选择视频文件夹';
  $('output-help').textContent = status.allowed ? '本插件的文件统一写入此目录，重名自动编号。' : '只需选定一次。选择器默认打开系统“视频”位置，之后保存到其 VideoDownloads 子文件夹。';
  lock();
}
function outputFilename(filename) {
  const extension = filename.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || '.mp4';
  return quickRules.downloadPath(filename.slice(0, -extension.length), extension).split('/').pop();
}
async function saveBlob(blob, filename, signal) {
  if (signal.aborted) throw new Error('已取消下载。');
  return saveToSelectedDirectory(blob, outputFilename(filename), { signal });
}
async function saveURL(url, filename, signal) {
  if (signal.aborted) throw new Error('已取消下载。');
  const response = await fetch(url, { signal, credentials: 'include' });
  if (!response.ok || !response.body) throw new Error(`视频服务器返回 HTTP ${response.status}。`);
  if (/text\/|json|html/i.test(response.headers.get('content-type') || '')) { await response.body.cancel(); throw new Error('服务器返回了网页而不是视频文件，未保存。'); }
  const total = !response.headers.get('content-encoding') ? Number(response.headers.get('content-length')) || undefined : undefined;
  return saveToSelectedDirectory(response.body, outputFilename(filename), { signal, expectedBytes: total, onProgress: bytes => task('saving', '正在保存到所选视频文件夹', `${formatBytes(bytes)}${total ? ' / ' + formatBytes(total) : ''}`, total ? bytes / total : undefined) });
}
async function finishQuickTask(state, message) {
  if (quickJob) await chrome.runtime.sendMessage({ type: 'vs-task-finish', jobId: quickJob, state, message }).catch(() => {});
}
async function fetchStream(stream, limit, signal, label, base, weight) {
  const port = chrome.tabs.connect(sourceTab, { name: 'bili-save-fetch' });
  const started = performance.now();
  return receiveStream(port, { urls: stream.urls, limit }, signal, (bytes, total) => {
    const elapsed = (performance.now() - started) / 1000;
    const speed = elapsed > .2 ? ` · ${formatBytes(bytes / elapsed)}/s` : '';
    task('downloading', label, `${formatBytes(bytes)}${total ? ' / ' + formatBytes(total) : ''}${speed}`, total ? base + weight * bytes / total : undefined);
  });
}
async function getEngine(signal) {
  task('merging', '正在准备合并引擎', '所有组件均来自插件本地文件，首次加载需要几秒钟。', .78);
  ffmpeg = new FFmpegWASM.FFmpeg();
  const abort = () => ffmpeg?.terminate();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) { abort(); throw new Error('已取消下载。'); }
  await ffmpeg.load({ coreURL: chrome.runtime.getURL('vendor/core/ffmpeg-core.js'), wasmURL: chrome.runtime.getURL('vendor/core/ffmpeg-core.wasm') });
  return ffmpeg;
}
async function run(mode) {
  if (busy || loading || !meta || !playback || !folderAllowed || (automatic && taskWasCancelled)) return;
  lastMode = mode;
  controller = new AbortController();
  const signal = controller.signal;
  busy = true; lock(); clearError(); $('retry').hidden = true;
  const part = meta.pages.find(p => p.cid === Number($('part').value));
  const selection = playback.direct || playback.videos[Number($('quality').value)];
  const stem = `${meta.title}${meta.pages.length > 1 ? ` - P${part.page} ${part.title}` : ''} - ${meta.bvid}`;
  let quickState = 'error', quickMessage = '';
  try {
    let blob, filename, saved;
    task('downloading', '正在连接视频资源', '请保留来源视频页与当前下载面板。', 0);
    if (meta.generic) {
      filename = safeFilename(selection.title, selection.extension);
      if (selection.kind === 'direct') {
        task('saving', '正在下载原始视频', '文件将保存到 VideoDownloads 文件夹。', .2);
        saved = await saveURL(selection.url, filename, signal);
      } else {
        let mime = selection.mime || 'video/mp4';
        const port = chrome.tabs.connect(sourceTab, { name: 'vs-blob-fetch', frameId: selection.frameId });
        const data = await receiveStream(port, { token: selection.token, limit: MAX_BYTES }, signal, (bytes, total) => task('downloading', '正在下载视频 Blob', `${formatBytes(bytes)}${total ? ' / ' + formatBytes(total) : ''}`, total ? .9 * bytes / total : undefined), message => { mime = message.mime; });
        const extension = { 'video/webm': '.webm', 'video/ogg': '.ogv', 'video/quicktime': '.mov' }[mime] || selection.extension;
        filename = safeFilename(selection.title, extension);
        saved = await saveBlob(new Blob([data], { type: mime }), filename, signal);
      }
      task('success', '文件已保存', saved.relativePath, 1);
      quickState = 'success'; quickMessage = '已保存到 ' + saved.relativePath;
      return;
    } else if (mode === 'cover') {
      const response = await fetch(meta.cover, { signal, credentials: 'omit' });
      if (!response.ok) throw new Error('封面下载失败，请稍后重试。');
      const data = await response.arrayBuffer();
      if (data.byteLength > 20 * 1024 * 1024) throw new Error('封面文件过大。');
      const mime = response.headers.get('content-type')?.split(';')[0];
      const ext = { 'image/png': '.png', 'image/webp': '.webp', 'image/jpeg': '.jpg' }[mime];
      if (!ext) throw new Error('服务器返回了不支持的封面格式。');
      blob = new Blob([data], { type: mime }); filename = safeFilename(stem + ' - 封面', ext);
    } else if (mode === 'video' && playback.direct) {
      const data = await fetchStream(playback.direct, MAX_BYTES, signal, '正在下载完整视频', 0, .9);
      blob = new Blob([data], { type: 'video/mp4' }); filename = safeFilename(stem, '.mp4');
    } else {
      if (!playback.audio) throw new Error('当前视频缺少可下载的 AAC 音频。');
      let videoBytes = 0;
      let videoData;
      if (mode === 'video') {
        videoData = await fetchStream(selection, MAX_BYTES, signal, '正在下载画面', 0, .62);
        videoBytes = videoData.byteLength;
      }
      const audioData = await fetchStream(playback.audio, MAX_BYTES - videoBytes, signal, '正在下载音频', mode === 'video' ? .62 : 0, mode === 'video' ? .14 : .76);
      const engine = await getEngine(signal);
      if (videoData) { await engine.writeFile('video.m4s', videoData); videoData = null; }
      await engine.writeFile('audio.m4s', audioData);
      const out = mode === 'video' ? 'output.mp4' : 'output.m4a';
      task('merging', mode === 'video' ? '正在合并画面与声音' : '正在整理音频', '保留原始质量，不重新编码。', .85);
      const code = await engine.exec(mode === 'video' ? ['-i', 'video.m4s', '-i', 'audio.m4s', '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', out] : ['-i', 'audio.m4s', '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', out]);
      if (code !== 0) throw new Error('合并失败。可以选择 H.264 编码或较低画质后重试。');
      const data = await engine.readFile(out);
      if (!data.byteLength) throw new Error('合并没有生成有效文件，请重试。');
      blob = new Blob([data], { type: mode === 'video' ? 'video/mp4' : 'audio/mp4' });
      filename = safeFilename(stem + (mode === 'video' ? ` - ${selection.label}` : ' - 音频'), mode === 'video' ? '.mp4' : '.m4a');
      engine.terminate(); ffmpeg = null;
    }
    if (signal.aborted) throw new Error('已取消下载。');
    task('saving', '正在保存文件', filename, .97);
    saved = await saveBlob(blob, filename, signal);
    task('success', '文件已保存', saved.relativePath, 1);
    quickState = 'success'; quickMessage = '已保存到 ' + saved.relativePath;
  } catch (error) {
    quickMessage = error.message || String(error);
    await refreshOutput();
    if (signal.aborted || /已取消/.test(error.message)) task('cancelled', '已取消', '本次任务已停止，你可以更换画质或重新下载。');
    else task('error', '下载未完成', error.message || String(error));
  } finally {
    ffmpeg?.terminate(); ffmpeg = null;
    busy = false; controller = null; lock();
    await finishQuickTask(quickState, quickMessage);
  }
}

$('refresh').addEventListener('click', refresh);
async function startDownload(mode) {
  if (busy || loading || choosingFolder || !meta || !playback) return;
  if (!folderAllowed) {
    choosingFolder = true; lock();
    try {
      // Call the OS picker directly from the trusted download click.
      await chooseOutputDirectory();
      await refreshOutput(); clearError();
    } catch (error) {
      if (error.name !== 'AbortError') displayError(error);
      return;
    } finally { choosingFolder = false; lock(); }
  }
  return run(mode);
}
$('choose-output').addEventListener('click', async () => {
  try {
    await chooseOutputDirectory();
    await refreshOutput(); clearError();
    if (automatic && playback && !busy && !loading && !taskWasCancelled) run('video');
  } catch (error) { if (error.name !== 'AbortError') displayError(error); }
});
$('part').addEventListener('change', () => { updateDuration(); task('idle', '准备好，就下载吧', '已切换分P，正在更新可用画质。'); loadPlayback(); });
$('download').addEventListener('click', () => startDownload('video'));
$('audio').addEventListener('click', () => startDownload('audio'));
$('poster').addEventListener('click', () => startDownload('cover'));
$('cancel').addEventListener('click', () => controller?.abort());
$('retry').addEventListener('click', async () => { await loadPlayback(); if (playback) run(lastMode); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && busy) controller?.abort(); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id === chrome.runtime.id && message.type === 'vs-task-cancel') {
    taskWasCancelled = true;
    controller?.abort();
    if (!busy) task('cancelled', '已取消', '下载任务已停止。');
    const deadline = Date.now() + 5000;
    const acknowledge = () => { if (!busy || Date.now() > deadline) reply({ ok: !busy }); else setTimeout(acknowledge, 20); };
    acknowledge();
    return true;
  }
});
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
if (!Number.isInteger(sourceTab) || sourceTab <= 0) { $('workspace').hidden = true; $('empty').hidden = false; refreshOutput(); }
else {
  chrome.tabs.get(sourceTab).then(tab => {
    if (!/^https?:\/\//.test(tab.url || '')) {
      $('workspace').hidden = true; $('empty').hidden = false;
    } else refresh();
  }).catch(() => { $('workspace').hidden = true; $('empty').hidden = false; $('empty-message').textContent = '来源页面已关闭。请打开视频页并重新点击插件图标。'; });
}
