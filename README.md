# FreeCast

组合两个直播间的画面、声音和弹幕，支持 B 站、虎牙、斗鱼、抖音及公开 HLS / FLV 直播源。

## 下载与安装

[下载 v1.20 安装包](https://github.com/Sur4lis/FreeCast/releases/download/v1.20/FreeCast_v1.20.zip) · [更新说明](https://github.com/Sur4lis/FreeCast/releases/tag/v1.20)

1. 完整解压安装包。
2. 在 Chrome / Edge 的扩展管理页开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的「FreeCast浏览器插件」文件夹。

升级时覆盖原插件目录并刷新扩展，原有收藏和设置保留。请保留插件文件夹。

## v1.20 更新

- 小窗自由框选裁切、拖动与等比缩放。
- A/B 两路独立 AI 去人声、保留人声。
- 弹幕悬停复制、回复、+1；关键词屏蔽、刷屏合并、避让区和 SC 自由定位。
- 收藏整套 A/B 组合，一键恢复观看设置。
- 本地保存为单个 MP4，合成画面、混音和画面弹幕；原画 / 性能两档，自动调整码率。
- 蓝粉皮肤、全屏弹幕输入框和更紧凑的布局；修复大表情发送、斗鱼链接解析和小窗拖拽。

## 源码

`browser-extension/` 为浏览器插件源码。Node.js 22 或更新版本：

```sh
npm ci
npm run prepare:assets
npm test
npm run pack
```

随后可直接加载 `browser-extension/`，安装包输出到 `release/`。

模型和 WASM 不放入 Git 历史；准备命令从已发布的 v1.10 安装包提取相同依赖，并校验 SHA-256。v1.20 安装包已包含这些文件，无需额外下载。

AI 在本地运行，需要硬件 WebGPU 支持。第三方库及模型来源、许可见 [第三方说明](browser-extension/第三方说明.txt)。

[使用说明](browser-extension/使用说明.txt) · [问题反馈](https://github.com/Sur4lis/FreeCast/issues)
