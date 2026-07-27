# Streaming 与状态恢复 Demo

这是一个本地、确定性的 CLI，用于演示 L10–L12 中由 Runtime 负责的边界：流式事件、终止状态、确认门槛与跨重启恢复。它不调用外部 API。

```bash
node examples/2026-07-27-streaming-state-recovery/demo.mjs all
```

支持四条路径：

- `normal`：按顺序拼接文本增量和工具调用参数增量，最后收到 `response.completed`。
- `error`：已有部分结果，但以 `response.failed` 结束，不能标记为成功完成。
- `cancel`：已有用户可见的部分结果，但以 `response.cancelled` 结束。
- `recovery`：新 Runtime 从持久化的 `waiting_confirmation` 会话恢复；它必须再次请求确认，不能直接写入。

`events.schema.json` 定义允许的事件类型及字段；`session.schema.json` 定义安全恢复确认门槛所需的持久化数据。脚本内置了轻量校验，因此无需安装依赖，使用 Node 即可运行。
