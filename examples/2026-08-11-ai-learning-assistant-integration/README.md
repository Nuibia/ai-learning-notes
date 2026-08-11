# AI 学习助手整合 Demo

L27「AI 学习助手整合」的当天独立 Demo。它会从一个最小、可测试的检索积木开始，逐步接入 Tool/MCP、人工确认、Eval、安全和 Trace，最终形成一条端到端任务链。

当前已经接入三组积木：

1. RAG 用来查知识：
   - 知识库中的文档带有稳定 `sourceId`；
   - Runtime 根据查询词选择相关文档；
   - 最终链路保留真实命中来源，不能凭空生成引用；
   - 当前使用关键词重合度，只用于展示链路，不代表生产级向量检索。
2. Tool 用来读取实时状态或执行动作：
   - Runtime 只允许调用白名单中的 `get_learning_progress` 和 `send_learning_summary`；
   - 未注册的 `delete_account` 会被拒绝；
   - 真实工具也可以由 MCP Server 提供。
3. Runtime 控制人工确认：
   - 有副作用的 `send_learning_summary` 必须经过人工确认；
   - `userConfirmed` 由 Runtime 持有，不能信任模型生成的工具参数；
   - 未确认时返回 `needs_confirmation`，并保证发送函数没有被调用。

第三个积木把 Eval、安全与 Trace 合在一起：

- Trace 保存本次检索来源、引用、工具调用、工具结果和最终回答；
- Eval 分别检查引用来源、预期工具和敏感信息；
- 安全用例只使用 `TEST_SECRET_CANARY` 这类合成标记，不把真实秘密写进 Eval；
- 用户已亲手补全 `secretSafe`，完整测试通过。

为了聚焦编排边界，这个 Demo 没有接入真实 LLM。真实 Agent 中可能由模型提出结构化 Tool Call；当前示例直接构造任务和工具调用，让 Runtime 的控制逻辑保持确定、可测试。

端到端任务把以上积木串在一起：

1. RAG 检索 Runtime 回滚知识并保留真实来源；
2. Tool 读取用户当前学习进度；
3. 发送工具在人工确认前停住，确认后才执行本地模拟发送；
4. Runtime 生成经过裁剪的 Trace；
5. Eval 检查引用、工具与合成敏感 canary。

观察完整链路（不会发送真实邮件）：

```bash
node demo.mjs
```

运行：

```bash
node --test
```
