# 画面自动对齐回归

自动对齐在 CPU 上处理帧，不依赖 OCR、模型文件或登录信息。开发环境使用项目要求的 Node.js 22+。先运行可完全复现的合成单测，再按需要运行生产 worker 回归：

```sh
npm test
node scripts/test-visual-sync.cjs
```

第二条命令生成 16 组时钟片段，不需要 FFmpeg 或外部素材。报告默认写入 `.cache/visual-sync/report.json`。它们覆盖精确框选、水平约 80% 共同区域、相同秒数但分钟不同（包含 `0/8`、`3/8`、`1/7` 等易混淆数字）的负例。

## 录像用例入口

完整 manifest 是 [`tests/fixtures/visual-sync-cases.json`](../tests/fixtures/visual-sync-cases.json)。录像文件不随代码分发；该 manifest 对应一组特定开发素材，记录文件身份的 SHA-256、裁剪范围和人工核对的时间差。不能把其他录像改成相同文件名就重现这些结果。

准备素材目录后运行：

```sh
node scripts/test-visual-sync.cjs --suite all \
  --fixtures /path/to/local-fixtures \
  --ffmpeg /path/to/ffmpeg \
  --output /path/to/report.json
```

目录中需要七个文件，可以使用指向已有本地素材的符号链接：

| 文件 | 用途 | 至少覆盖到的文件时间 |
| --- | --- | ---: |
| `bp-a.mp4` | 第三方解说 BP 阶段的小窗 | 290 秒 |
| `bp-b.mp4` | 对应官方 BP 画面 | 270 秒 |
| `a-strip-master.mp4` | 官方记分板条嵌入背景的合成第三方画面 | 45 秒 |
| `a-clock-master.mp4` | 官方时钟嵌入背景的合成第三方画面 | 45 秒 |
| `official-master.mp4` | 上述合成画面使用的官方原片 | 45 秒 |
| `other-match.mp4` | 不同比赛的负例 | 37 秒 |
| `no-official-picture.mkv` | 第三方隐藏官方画面的负例 | 240 秒 |

脚本在解码前核对素材哈希；缺失、错用或过短的素材会报错，不会缩短用例后算通过。只运行无素材用例时不会访问录像或运行 FFmpeg。所有读入都是本地文件；不会打开浏览器、访问直播间、获取 Cookie 或下载录像。

常用筛选：

```sh
# 只列出全部用例，不访问素材。
node scripts/test-visual-sync.cjs --suite all --list

# 精确按名称选择，--case 可以重复；未显式指定 --suite 时从全量选择。
node scripts/test-visual-sync.cjs \
  --case real-bp-x80 --case real-bp-both-inner80 \
  --fixtures /path/to/local-fixtures --ffmpeg /path/to/ffmpeg

# 仅录像用例；默认缓存位于 .cache/visual-sync/frames。
node scripts/test-visual-sync.cjs --suite video \
  --fixtures /path/to/local-fixtures --cache /path/to/frame-cache
```

`--ffmpeg` 默认使用 PATH 中的 `ffmpeg`。缓存存储原始 RGBA 帧，全量包含单框模式的全分辨率官方帧，可能占用数 GB。每次解码最多等待 120 秒，缓存不完整时会报错并提示删除对应条目。`--runtime DIR` 可测试另一份完整的生产 UI 目录，默认使用当前检出的 `browser-extension/ui`。

## 40 个用例的覆盖和已知失败

当前固定素材矩阵包含 24 个录像用例和 16 个生成时钟用例，共 19 个匹配正例、21 个拒绝负例。2026-10-30 的完整回归为 **39/40**：18 个正例通过，21 个负例均未触发对齐。

| 分组 | 数量 | 验证内容 |
| --- | ---: | --- |
| 录像基本及偏框用例 | 15 | BP 精确框、水平/垂直约 80% 重合、约 81% 双向重合、放大 10%、两框都偏、静止/循环/不同比赛/官方画面消失 |
| 合成时钟 | 16 | 分钟冲突负例，以及精确框和约 80% 共同区域正例 |
| 大延迟 BP | 1 | 正确识别 −42.5 秒；文件时间原点不同 |
| 原单框模式回归 | 7 | 官方整帧定位、正负延迟及拒绝负例 |
| 两框均不精确但在官方画面内 | 1 | 约 80% 共同区域，正确识别 −2.5 秒 |

`real-bp-both-rough` 是保留的**失败正例**：A 框额外包含官方小窗之外的客户端背景，当前算法没有稳定匹配。manifest 仍为 `expectMatch: true`，目标偏移 −2.5 秒；没有将其改为拒绝负例。它说明“约 80% 重合可容忍”有条件：两框应主要覆盖同一官方内容，混入小窗之外的背景仍可能导致失败。这里的共同区域比例是 `min(共同面积/A面积, 共同面积/B面积)`，不是 IoU。

默认发现该失败时命令返回 **1**。若运行环境明确允许此已知限制，可加 `--allow-known-failures`；只有该用例“没有稳定匹配”能获准放行，错误偏移、任何其他失败或执行错误仍失败。无论退出策略如何，JSON 中该用例保持 `passed: false`，总数保持 39/40。配置/素材/解码错误返回 **2**。

无官方画面负例验证的是**拒绝更新偏移**，不能证明从没有共同画面的两路流恢复时间差。真实客户端已取得偏移后遇到小窗消失，应保留当前偏移；后续有共同动态画面时再校准。

## 运行了哪些生产代码

入口通过 `vm` 执行当前的 `visual-sync-worker.js`。worker 的 `importScripts` 映射到同目录三个共享模块的 CommonJS 导出：

- `visual-sync-core.js`：时间匹配、稳定性和偏移换算。
- `visual-sync-inset.js`：单框对官方整帧的定位。
- `visual-sync-overlap.js`：双框空间重合校正。

这里使用生产算法，没有另写一个测试用匹配器。共享模块以 Node 原生模块加载，避免 VM 全局属性查找额外放大处理耗时。每次空间定位 `located` 或配准 `registered` 时，测试会像 UI 控制器一样重置稳定性，防止把变更前后的结果拼成一次确认。

每路按 4 fps 输入，裁剪区域最长边 256 像素；单框模式的官方整帧最长边 1920 像素。`crop=...:exact=1` 避免 FFmpeg 色度采样把奇数像素裁剪位置取整。报告记录本次四个生产文件、manifest 和使用素材的 SHA-256，以及 Node/FFmpeg 版本；运行结束再次核对生产文件哈希，文件变化时要求重跑。

两路输入的 `mediaOrigin` 与文件 `start` 各自独立。本入口模拟初始手动偏移为 0 的等速播放，使用生产 `targetOffset` 把匹配的媒体时间差换算成期望偏移；不能直接把两个视频的 PTS 相减当作直播延迟。正偏移延迟 A，负偏移延迟 B。v1.24 控制器实际应用时结合当前播放位置和已有偏移，重新锚定两路 playout 时钟；这部分由 `npm test` 的控制器测试覆盖，本录像入口不执行播放器调度。

## 容差、耗时和适用边界

真实 BP 对应位置人工核对到 0.25 秒采样粒度，自动回归允许绝对偏移误差 **0.35 秒**。正例必须产生稳定匹配且偏移在容差内；负例必须全程没有稳定匹配。首个稳定匹配即模拟一次自动应用，和生产界面的一次校准行为一致。

固定矩阵中的确认需要约 22–74 秒的**素材时间**；BP 片段通常到 72 秒，两框内偏用例到 74 秒。脚本加速馈入帧，因此这不等于命令运行的墙钟时间。`processingMs` 统计读取一帧及同步调用 worker 的耗时，不包含预解码、真实 Web Worker 消息往返或播放器开销，也不是系统 CPU 占用率；单次峰值会受运行平台和定位/配准阶段影响。

离线通过证明这些素材上的匹配和拒绝行为。浏览器实测仍需验证框选交互、CORS/黑屏、播放器缓冲/暂停/换流、后台调度和实际偏移应用；它们不能由本入口代替。

## 添加自己的素材

复制 manifest，保留 `schemaVersion: 1`、`sampleRate: 4` 和明确的容差，再用 `--manifest /path/to/cases.json` 运行。每个本地素材在 `assets` 中登记 SHA-256；每个用例提供：

- 唯一名称、`mode: single|dual`、`expectMatch`，正例另有人工确认的 `expectedOffset`。
- A/B 的相对 `file`、原始 `dimensions: [宽, 高]`、`roi: [x, y, 宽, 高]`、文件 `start` 和 `duration`。
- 可选独立 `mediaOrigin`，用于验证两路不同媒体时间原点；`static` 和 `repeatSeconds` 用于拒绝控制。

`synthetic: "clock"` 的来源由脚本生成，不需要 `file`；可用 `minute` 指定分钟数字（包含 0）。录像用例应保留人工确认的目标偏移和真实失败；每个偏框实验尽量只改变裁剪几何，避免同时移动素材起点而掩盖回归。
