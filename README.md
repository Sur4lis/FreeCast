# FreeCast · 二路自由

**画面你来选，解说听你的。**

本项目采用 **Vibe Coding（AI 辅助编程）** 方式开发。

## 功能

- 自由组合两个直播间的画面与声音，支持小窗放大、拖动和主小窗互换。
- 支持 B站、虎牙、斗鱼、抖音，以及部分公开 HLS / FLV 直播源。
- 手动时间对齐、画质选择、独立音量与收藏。
- B站弹幕接收与发送、本地 AI 人声过滤。

## 下载与安装

在 [Releases](https://github.com/Sur4lis/FreeCast/releases) 下载 **FreeCast_v1.07.zip**。

1. 解压到固定文件夹。
2. Chrome 打开 chrome://extensions；Edge 打开 edge://extensions。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”。
4. 选择含 manifest.json 的 **FreeCast浏览器插件** 文件夹。
5. 点击浏览器工具栏的 FreeCast 图标使用。

更新时覆盖原插件目录，再刷新扩展，无需卸载。GitHub 自动生成的 Source code 不是安装包。

## 使用说明

- 首次接入其他平台需允许网站访问权限；登录使用同一浏览器的相应平台账号。
- 独立弹幕目前仅支持 B站，其他小平台不保证全部兼容。
- AI 去人声需要硬件 WebGPU，可能削弱部分游戏音效；时间偏移需手动校准。
- 音频处理在本机运行，不上传至 AI 服务。第三方许可与模型来源见安装包说明。

问题反馈请提交 [Issues](https://github.com/Sur4lis/FreeCast/issues)。
