(() => {
  if (globalThis.VideoQuickRules) return;
  function isCopyShortcut(event, context = {}) {
    return !!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !event.repeat && !event.isComposing && String(event.key).toLowerCase() === 'c' && !context.editable && !String(context.selectedText || '').length;
  }
  function classifyMedia(value, pageURL, mime = '') {
    try {
      const page = new URL(pageURL);
      const url = new URL(value, pageURL);
      if (!value || !['http:', 'https:'].includes(page.protocol) || url.username || url.password) return { kind: 'unsupported' };
      const extension = /webm/i.test(mime) || /\.webm$/i.test(url.pathname) ? '.webm' : /\.og[gv]$/i.test(url.pathname) ? '.ogv' : /\.mov$/i.test(url.pathname) ? '.mov' : '.mp4';
      if (url.protocol === 'blob:') return url.origin === page.origin ? { kind: 'blob', url: url.href, extension } : { kind: 'unsupported' };
      if (!['http:', 'https:'].includes(url.protocol) || /\.(m3u8|mpd)(?:$|\/)/i.test(url.pathname) || /mpegurl|dash\+xml/i.test(mime)) return { kind: 'unsupported' };
      return { kind: 'direct', url: url.href, extension };
    } catch { return { kind: 'unsupported' }; }
  }
  function downloadPath(value, extension) {
    if (!['.mp4', '.webm', '.ogv', '.mov', '.m4a', '.jpg', '.png', '.webp'].includes(extension)) throw new Error('不支持的文件格式。');
    let name = String(value || 'video').replace(/^[.\\/ ]+/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').slice(0, 120).replace(/[. ]+$/g, '');
    if (!name) name = 'video';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
    return 'VideoDownloads/' + name + extension;
  }
  function classifyVideoLink(value, pageURL, { hasImage = false, videoHint = false } = {}) {
    try {
      const url = new URL(value, pageURL);
      if (!value || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      if (/\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(url.pathname)) return classifyMedia(url.href, pageURL);
      const bili = ['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(url.hostname) && /^\/video\/(BV[a-zA-Z0-9]{10}|av\d+)\/?$/.test(url.pathname);
      const short = url.hostname === 'b23.tv' && /^\/[a-zA-Z0-9]+\/?$/.test(url.pathname);
      const generic = (hasImage || videoHint) && /\/(?:watch|videos?|play)(?:\/[^/?#]+|\.html)?\/?$/i.test(url.pathname);
      if (bili || short || generic) return { kind: 'page', url: url.href };
    } catch {}
    return null;
  }
  globalThis.VideoQuickRules = Object.freeze({ isCopyShortcut, classifyMedia, classifyVideoLink, downloadPath });
})();
