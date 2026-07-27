# SSE 事件生命周期与增量渲染

这是为 L10「Streaming 与事件生命周期」补充的独立工程证据。它模拟 SSE 帧解析、前端视图增量更新，以及正常、失败、取消三类终态。

运行：

```bash
node examples/2026-07-27-sse-lifecycle-rendering/demo.mjs
```

预期最后一行：

```text
通过：SSE 增量渲染与三类终态均已独立验证
```

## 可以检查什么

- `output_text.delta` 到达时，视图中的 `text` 立即累积；
- `response.completed`、`response.failed`、`response.cancelled` 不被混成同一个“完成”；
- 失败和取消时保留已经展示的部分文本，但不会伪装成成功；
- 终态后再次收到文本增量会被拒绝。

## 证据边界

这个 Demo 是 AI 生成并由机器执行的工程验证，用来补充文章和代码证据；它不替代学习者自己的 SSE 实践，也不单独构成学习完成证据。学习者可以检查代码和运行输出，确认它是否与自己的经验一致。
