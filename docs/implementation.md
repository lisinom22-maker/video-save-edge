# Bili Save / B站视频保存助手

用户已选择纯插件，并要求直接完成，不再逐项确认。

## 交付范围

Edge Manifest V3。工具栏按钮打开独立扩展标签页，识别来源 B站普通视频页；支持 BV/av、多分P选择、当前账号已获授权的画质、MP4 合并、AAC 音频和封面保存、取消、重试。第一版不实现直播录制、整站爬取、番剧与课程。没有服务器，不导出或存储 Cookie。

## 实现

- 在来源标签页 MAIN world 请求站点 API，复用网页登录态。WBI 参数仅本地签名。
- 内容脚本从获准的 B站 CDN 拉取流，向扩展页通过 Port 逐块传输并等待确认，支持断开和取消。
- FFmpeg 0.12.15 / 单线程 core 0.12.10 全部随包提供，在 Web Worker 内以 stream copy 合并；不远程执行代码。
- 一个面板同时一个任务，音视频合计最多 384 MiB，超限可换低画质。关闭来源页或下载面板会中断尚未完成的任务。
- 页面解析、流地址、文件名均验证；拒绝非 HTTPs / 非允许 CDN、DRM 与预览响应。下载不会突破登录或会员权益。
- 最终文件通过浏览器下载管理器保存；Blob 保留到完成或中断事件，避免提前释放。

## 验证

先为解析、签名、画质选择和传输边界写回归测试，再实现。使用隔离 Chromium/Edge 扩展环境验证加载、真实 Worker 合并、MP4 音视频轨道、取消、错误和多分P。B站公网可用性与账号授权取决于实际网络；未实测的部分明确标注。

## 调研依据

- https://github.com/c-yyy/bili-mux ：架构与 CDN 来源约束参考，未复制项目源代码。
- https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py ：DASH 字段及 WBI 协议参考。
- https://ffmpegwasm.netlify.app/docs/getting-started/usage/ ：浏览器 FFmpeg API。
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/reference/api/downloads

## 执行顺序

1. 建立核心协议与传输测试。
2. 实现 API 解析、内容脚本、扩展入口与下载面板。
3. 装入固定版本本地 FFmpeg，保留许可与来源。
4. 运行核心测试、扩展集成测试、真实合并和文件验收。
5. 提供免构建插件目录、ZIP 与中文安装说明。
