# Video Save · Edge 网页视频保存助手

鼠标悬停视频、封面或视频链接，按 **Ctrl+C** 保存到本地。当前版本 **1.2.3**。

## 安装

从 [Releases](https://github.com/lisinom22-maker/video-save-edge/releases) 下载 `Bili-Save-Edge-1.2.3.zip` 并解压。

1. 打开 `edge://extensions`，开启开发人员模式。
2. 点击“加载解压缩的扩展”，选择解压后的 `extension` 文件夹。
3. 首次下载时选择系统“视频”文件夹并允许写入。后续统一保存到里面的 `VideoDownloads`。
4. 鼠标悬停视频或封面，按 Ctrl+C。也可以点击插件图标手动选择分P和画质。

视频直接写入所选文件夹，**不会新增 Edge 下载记录**。保存成功后结果页保留文件名和保存路径。同名文件自动编号。

## 支持范围

- B站普通视频：音视频合并为 MP4，支持分P、可用画质、单独音频和封面。
- 普通网站 HTML5 MP4 / WebM、可读取的视频 Blob。
- 有真实链接的视频封面；常见视频详情页会在后台等待主视频资源。
- HTTP(S) iframe、播放器覆盖层、开放 Shadow DOM。

输入框和文字选区中的 Ctrl+C 保持正常复制，不读写剪贴板。

暂不支持通用 HLS/DASH、直播、DRM、番剧和课程。纯 JavaScript 按钮或特殊网站需要专门适配。B站合并及 Blob 上限 384 MiB，普通视频流式写盘。仅保存你有权下载的内容。

## 从源码运行

安装包已包含全部依赖，无需 Node.js、本地 FFmpeg 或服务器。

克隆源码仓库后，先用 Node.js 20+ 补齐并校验固定版本的 WASM 运行时，再在 Edge 加载 `extension` 文件夹：

```sh
node tools/restore-wasm.mjs
npm test
npm run check
```

WASM 为约 32 MB 的第三方依赖，不放入 Git 源码树；恢复脚本按 `extension/vendor-lock.json` 下载并校验 SHA-256。完整源码压缩包和安装包在 Releases 提供。

开发工具和浏览器回归脚本在 `tools/`，浏览器测试使用隔离配置，不读取个人浏览器资料。可设置 `PLAYWRIGHT_PACKAGE` 指定 Playwright 路径。打包命令为 `npm run package`，需要 Python 3，可用 `PYTHON` 指定解释器。

## 修复与验证

- 修复插件重载后旧网页快捷键连接失效。
- 首次未选择目录时，点击下载直接选择文件夹并继续，取消后可重试。
- 成功后保留结果页，显示保存位置和文件写入方式。
- 核心、传输、目录写盘、快捷键、取消竞态、封面解析、B站合并及真实 Edge 回归。

B站回归使用受控接口与测试视频，不代表所有真实网站或视频都已验证；实际下载依赖当前观看权限及服务器响应。

第三方依赖和许可证见 [THIRD_PARTY_NOTICES](extension/THIRD_PARTY_NOTICES.md)。扩展不提供遥测，不上传视频。
