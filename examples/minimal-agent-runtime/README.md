# 最小 Agent Runtime：messages 与 Tool Calling 循环

这是 2026-07-17 学习文章的可运行案例，不连接真实 LLM，也不读取真实文件。

它只保留 Runtime 的控制职责：

```text
user goal
→ model.decide(messages)
→ Runtime 解析和校验模型输出
→ read_file
→ assistant Tool Call + tool result 回填 messages
→ model.decide(messages)
→ final
```

## 运行

需要 Node.js 18+：

```bash
node --test runtime.test.mjs
```

## 这个案例证明什么

- Runtime 而不是模型执行工具；
- 模型输出在执行前必须被 Runtime 解析和校验；
- `assistant` Tool Call 与 `tool` 结果必须一起回填，下一轮模型才有完整因果链；
- 只有 `TransientToolError` 会有限重试；权限、路径、文件类型错误会立刻拒绝；
- `maxRounds` 限制的是模型决策轮数，不等于工具重试次数。

## 这个案例不代表什么

- 不是某个真实模型 API 的固定消息格式；
- 不是生产级权限、审计、取消、并发或持久化方案；
- 不是 MCP 的实现。

真实 API 的 Tool Calling 表达会不同；可迁移的是控制循环，而不是这里的对象字段或 role 名称。
