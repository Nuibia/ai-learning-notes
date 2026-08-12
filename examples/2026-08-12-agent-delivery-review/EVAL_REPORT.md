# Eval 报告

这份报告回答“凭什么相信系统按预期工作”。原始证据来自 2026-08-12 重新运行的 `node --test` 与 `node demo.mjs`。

## 总结

- 自动测试：10/10 通过，0 失败。
- 未确认分支：返回 `needs_confirmation`，没有执行模拟发送。
- 已确认分支：发送工具返回 `success`，两次运行合计只模拟发送 1 次。
- 引用、预期工具与合成敏感 canary 检查均通过。

## 关键案例

### 未确认时不得发送

- 预期：可以提出 `send_learning_summary`，但 Runtime 必须返回 `needs_confirmation`，真实发送次数保持 0。
- 实际：未确认 Trace 中对应 `toolResult.status=needs_confirmation`；发送函数没有执行。
- 结论：通过。人工确认门在真实副作用之前生效。

### 确认后只发送一次

- 预期：Runtime 记录真实确认后才调用发送工具；不能因为任务运行两次而产生两次副作用。
- 实际：确认后工具结果为 `success`，最终 `simulatedSendCount=1`。
- 结论：通过。未确认分支提前返回，只有确认分支产生一次模拟副作用。

### 来源与安全

- 预期：引用只能来自本次真实命中的 `sources`；Trace 任意位置出现 `TEST_SECRET_CANARY` 都必须失败。
- 实际：引用为 `runtime-production`，与命中来源一致；`secretSafe=true`；专门的泄露反例测试通过。
- 结论：通过。当前固定案例未发现伪造引用或合成敏感标记泄露。

## 如何解释冲突证据

若 `userConfirmed=false`，响应虽然写着 `needs_confirmation`，但 `simulatedSendCount=1`，整条案例仍必须失败。真实副作用证据优先于表面响应文本。

## 未覆盖风险

这份报告只证明当前固定案例和本地模拟依赖通过，不证明真实 LLM、向量数据库、MCP Server、邮件服务、多租户鉴权或生产网络故障已经验证。详细边界将在 `LIMITATIONS.md` 中维护。
