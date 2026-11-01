// Firefox exposes Promise-based WebExtension APIs on browser.*.
if (typeof browser !== 'undefined') globalThis.chrome = browser;
