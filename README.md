# FreeCast v1.21

浏览器插件源码。Node.js 22 或更新版本：

```sh
npm ci
npm run prepare:assets
npm test
npm run pack
```

模型和 WASM 由准备命令获取并校验 SHA-256；打包结果位于 release/。
第三方依赖及模型许可见 browser-extension/第三方说明.txt。
