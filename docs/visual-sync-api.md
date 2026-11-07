# 自动对齐内部接口

自动对齐由播放器控制器、Web Worker 和共享算法模块组成，没有独立 HTTP 服务或上传接口。以下是当前源码的内部协议；它还不是面向第三方的版本化公共 API。

## 界面与控制器

“画面自动对齐”与“时间轴对齐”为独立区域，用户通过“框选匹配区域”“开始对齐”“取消匹配”“撤销对齐”操作。选区为相对于源视频的 `{x, y, w, h}`，每项范围为 0–1；界面百分比会按源像素取整，最小选区 12×8 像素。选区不读取或写入小窗的裁剪和布局状态。

[`auto-sync.js`](../browser-extension/ui/auto-sync.js) 管理选区、采样、会话及应用偏移。它目前只导出 `window.autoSync.invalidate(message?)`，供换源、暂停、回看和手动设置变更取消旧会话及撤销记录。`start` 和选区状态封装在控制器内，没有公开的 `autoSync.start()`。

控制器要求两路正常播放且页面在前台。支持稳定运行的 AI 音频处理；加载、音频缓冲或上一轮平滑校准未完成时不能开始新一轮。一次会话最多持续 90 秒，每路约采样 4 fps；每路最多有一帧等待 Worker 的 `ready` 回复，忙时丢弃本次采样，防止排队增长。读取画面失败、三秒收不到连续帧、暂停或媒体时间跳变都会取消会话。

会话开始时调用 `mediaBuffers.reserveHistory(channel, 60)`，为两路预约足以覆盖最大偏移的历史缓存；该函数返回可重复调用的释放函数。预约只提高后向保留时长，不增加前向预载或字节上限，也不缩短用户选定的回看缓存。所有结束路径均释放预约，成功对齐后再按新延迟更新缓存策略。

## Worker 输入

[`visual-sync-worker.js`](../browser-extension/ui/visual-sync-worker.js) 先接收配置：

```js
worker.postMessage({ type: 'configure', mode: 'dual' });
```

`single` 表示 A 是用户选择的小窗，B 是完整官方画面，由 Worker 在 B 中定位；`dual` 表示 A/B 都已裁剪，由 Worker 校正两框的平移和统一物理缩放。新配置会清空历史、定位和配准状态。

随后发送每帧：

```js
worker.postMessage({
  key: 'a',               // 'a' 或 'b'
  at: 123.25,             // 同一单调时钟上的显示时间，单位秒
  mediaTime: 1008.75,      // 该路视频自己的媒体时间，单位秒
  width: 125,
  height: 33,
  rgba                    // Uint8ClampedArray，长度 width * height * 4
}, [rgba.buffer]);
```

`at` 来自 `requestVideoFrameCallback` 的 `expectedDisplayTime / 1000`，不是 Unix 时间。`mediaTime` 来自同次回调；两路媒体时间原点可以完全不同。没有该回调时，控制器以 `performance.now() / 1000` 和 `video.currentTime` 兜底。两种时间在每一路中都必须递增。

`width` 和 `height` 是至少为 2 的整数。双选区最长边不超过 256 像素；单选区的 A 同样限制为 256，B 整帧最长边不超过 1920。RGBA 缓冲区传输后在发送端被移交，下一帧应使用新缓冲区。Worker 每路保留最多 90 秒、380 帧的历史，每两秒尝试一次时间估计。空间配准完成后释放原始灰度历史，继续保留有界特征历史。

## Worker 输出

| `type` | 主要字段 | 含义 |
| --- | --- | --- |
| `ready` | `key` | 本帧处理完成，对应一路可以发送下一帧。 |
| `located` | `region`, `score` | 单选区在 B 整帧中找到了位置；区域相对 B 输入图像归一化。 |
| `registered` | `regions: {a, b}`, `coverage` | 双选区建立共同区域；区域分别相对两路输入选区归一化。 |
| `result` | `at`, `result` | 当前时间匹配结果，格式见下。 |
| `error` | `message` | 处理失败；控制器终止会话。 |

`located` 和 `registered` 只表示空间定位成功，不表示时间已对齐。控制器收到它们时重置之前的连续确认记录。

`result.status` 包括 `collecting`、`locating`、`registering`、`location-ambiguous`、`registration-ambiguous`、`static`、`unmatched`、`ambiguous` 和 `match`。成功结果形如：

```js
{
  type: 'result',
  at: 40,
  result: {
    status: 'match',
    mediaDelta: 808,       // 同一画面的 mediaTime_A - mediaTime_B
    lag: 8,               // 匹配帧的 at_A - at_B
    score: 0.98,
    margin: 0.12,
    pairs: 30,
    contextScore: 0.97,
    activePixels: 80
  }
}
```

`score` 和 `margin` 是相关性及候选分离度指标，不是概率；失败时的诊断字段可以变化，调用方不能依赖其固定结构。尤其不能把 `mediaDelta` 当成应直接写入滑块的秒数。

结构校验失败时，`diagnostic.refinedBestFixedStructure.detail` 可包含 `residualBounds`（相对共同区域归一化的残差包围框）和 `boundaryEdges`（`top`、`bottom`、`left`、`right` 的子集）。这些字段只用于提示差异位置，不降低匹配门槛。边缘差异可能来自截断、压缩或确实不同的数字；它不能证明两路是同一画面。只有时间相关性和上下文都足够强时，界面才显示具体的边缘不一致提示。

## 从匹配到播放偏移

控制器要求连续三次 `match`，跨度至少 3.5 秒，媒体时间差变化不超过 0.3 秒；非匹配结果或空间定位改变会清空确认。最终滑块范围是 ±60 秒。

v1.24 根据当前两路正在播放的位置计算：

```text
newOffset = oldOffset + currentTime_A - currentTime_B - mediaDelta
```

结果取到 0.1 秒。正偏移延迟 A，负偏移延迟 B。控制器检查实际目标是否在缓冲区，再调用现有 `updateOffset` 并锚定两路播放时钟，避免重复应用手动偏移。撤销也会检查目标缓冲及会话是否仍有效。

共享模块的 `VisualSync.targetOffset(edgeA, edgeB, mediaDelta)` 仍用于固定边缘模型的离线测试；它不代替 v1.24 控制器的当前播放位置换算。

## 共享模块与测试入口

- `VisualSyncOverlap.register(aFrames, bFrames)` 仅求空间关系；不同选框长宽比可以由共同裁剪解释，但不是任意非等比拉伸模型。
- `VisualSyncInset.estimate(aFrames, bFrames, {registered})` 估计时间关系，同时校验动态内容和固定文字。固定边缘像素可能包含决定分钟数字的真实笔画，不能无条件忽略。
- `VisualSync.History` 和 `VisualSync.Stability` 提供历史上限和连续确认。
- `npm test` 覆盖算法、真实 Worker 消息链路和控制器；`npm run test:visual-sync` 提供可移植录像/生成帧入口，详见[测试说明](visual-sync-testing.md)。

默认每次“开始对齐”执行一次校准。可选择每 60、300、600 或 1200 秒复检；仅在有已保存选区、页面前台且正常直播时启动。两次匹配之间不保留 Worker，周期与组合选区保存在本机。定时复检和 AI 输入时钟调整使用平滑速率校准，AI 补偿仍由原音频管线独立管理。未来扩展调用接口时，应保留时间单位、消息背压、空间变化重置确认、失败不改偏移，以及完整分钟字形的负例约束。
