# 多供应商 Adapter 与有限重试 Runtime

这是 2026-07-22 学习文章的可运行案例。它不连接真实 LLM，也不读取真实文件，而是通过依赖注入稳定复现 Runtime 的校验、供应商错误归一化和有限重试。

```text
user goal
→ model.decide(messages)
→ Runtime 解析和校验模型输出
→ read_file adapter 将供应商错误归一化为内部错误类型
→ Runtime 仅对明确的 TransientToolError 有限重试
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
- 模型输出在执行前必须由 Runtime 解析和校验；
- `maxToolAttempts` 表示包含首次调用在内的工具总尝试次数；
- 非法的 `maxToolAttempts` 会在模型或工具调用前显式拒绝；
- 供应商 `status/code` 在 adapter 边界归一化；
- 只有 `TransientToolError` 会有限重试，授权错误和陌生错误立即终止；
- 429 最多进行有限重试，403 与陌生 599 都不会重复调用；
- `maxRounds` 限制模型决策轮数，不等于工具尝试次数。

## 这个案例不代表什么

- 不是某个真实模型或供应商 API 的固定协议；
- 不是生产级权限、审计、取消、并发或持久化方案；
- 没有展示非幂等写工具所需的幂等键和人工确认；
- 不是 MCP 的实现。

真实供应商的错误契约会不同。可迁移的是 adapter 与 Runtime 的职责边界，而不是这里列出的具体状态码。
