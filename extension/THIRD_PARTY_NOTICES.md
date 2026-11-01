# Third-party notices

Bili Save's application code is independently written. The following bundled third-party components retain their original licenses.

## @ffmpeg/ffmpeg 0.12.15

- Package: https://www.npmjs.com/package/@ffmpeg/ffmpeg/v/0.12.15
- Source/build repository: https://github.com/ffmpegwasm/ffmpeg.wasm
- License: MIT, Copyright (c) 2019 Jerome Wu. Full notice: `vendor/ffmpeg/LICENSE`.
- Bundled files: `vendor/ffmpeg/ffmpeg.js`, `vendor/ffmpeg/814.ffmpeg.js`.
- Modification: the wrapper's unused developer-machine base URL and the worker's default CDN URL are replaced with extension-local URLs by `tools/vendor.mjs`. The application also explicitly specifies local core and WASM URLs.

## @ffmpeg/core 0.12.10 (single thread)

- Package: https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
- Source/build repository and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm
- Core release/build history: https://github.com/ffmpegwasm/ffmpeg.wasm/releases
- Package-declared license: GPL-2.0-or-later. Full GPLv2 license: `vendor/core/LICENSE`.
- Bundled, unmodified binary distribution: `vendor/core/ffmpeg-core.js`, `vendor/core/ffmpeg-core.wasm`.
- This distribution contains FFmpeg and its compiled-in libraries; upstream components retain their respective notices. The upstream source/build repository records the build scripts and component source/version configuration. FFmpeg source and license information: https://ffmpeg.org/download.html and https://ffmpeg.org/legal.html.
- This local development package is provided with complete application source. Before redistributing the bundled GPL binary outside personal use, supply the complete corresponding source and applicable upstream notices as required by its license. Links alone are not a substitute for corresponding-source distribution obligations.

Fixed download URLs and upstream SHA-256 values are recorded in `vendor-lock.json`. Downloaded package metadata is included in each vendor directory. No component is downloaded at extension runtime.
