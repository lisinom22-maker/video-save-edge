# 多浏览器版本 1.3.0

## Chrome / Edge 等 Chromium 浏览器

解压 Video-Save-Chromium-1.3.0.zip，在 chrome://extensions 或 edge://extensions 开启开发人员模式，加载 extension 文件夹。Chrome 采用与 Edge 相同的 MV3 后台及目录选择 API。

支持目录选择的浏览器首次选定系统“视频”后写入 VideoDownloads。不支持该 API 时使用浏览器原生下载，保存到默认下载位置的 VideoDownloads，并显示在下载记录。

## Firefox 140+

解压 Video-Save-Firefox-1.3.0.zip。打开 about:debugging#/runtime/this-firefox，点击“临时载入附加组件”，选择 extension/manifest.json。

当前为未签名开发包，临时加载会在重启 Firefox 后失效；永久安装还需 Mozilla 签名或上架，尚未完成。无需关闭浏览器签名保护。

Firefox 版使用后台页面、browser API 和浏览器原生下载。默认文件位置为浏览器下载目录 / VideoDownloads。要统一放进系统“视频”，请自行在 Firefox 下载设置中将默认保存位置设为“视频”；本插件不会改动全局设置。无需每次手动选择目录。

快捷键仍为鼠标悬停视频/封面后 Ctrl+C。B站合并文件在内存处理后交给浏览器保存，合并/Blob 上限 384 MiB；普通直链通过浏览器下载，不受此上限约束。浏览器报告完成后才显示成功，中断或取消不会当作成功。

## 验证范围

共享核心测试及隔离 Edge 原生下载回退测试覆盖实际视频字节写盘。Firefox 包的 manifest 和 ZIP 结构单独校验。本机未安装 Firefox，尚未完成 Firefox 真实端到端验收，不将开发适配包描述为已通过 Firefox 实机验证。Chrome 自动化加载尝试被本机 Chrome 拦截，因此 Chrome 实机验收同样未完成；请按上方开发者模式手动加载，不能将 Edge 回归等同于 Chrome 实测。

安装包不等同于 Chrome 网上应用店或 Mozilla 附加组件商店上架。

参考：
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download
- https://www.extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/
