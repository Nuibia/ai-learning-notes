# 跟着 AI 学习 AI

这是我的个人 AI 学习与公开输出仓库。

我会把每天真正理解的概念、项目实践后的复盘，以及准备发布到掘金等平台的文章同步到这里。这里保存的是适合公开阅读的学习成果，不保存本机配置、项目私有信息和内部协作资产。

## 学习方法

```text
提出问题
→ 主动回忆
→ AI 讲解与纠偏
→ 项目或案例验证
→ 写学习卡片
→ 整理为公开文章
```

## 文章

<!-- article-index:start -->
- 2026-07-15：[我一直把 LLM 当成 Agent，直到我理解了 Runtime](./articles/2026-07-15-agent-runtime-and-llm.md)（[掘金](https://juejin.cn/post/7662376768221331465)）
- 2026-07-16：[Agent Runtime 出错后，应该由谁恢复？](./articles/2026-07-16-agent-runtime-error-recovery.md)（[掘金](https://juejin.cn/spost/7662777075909607475)）
- 2026-07-17：[从 messages 看懂 Agent 的工具调用循环：Runtime 如何衔接模型与工具](./articles/2026-07-17-agent-runtime-messages-loop.md)（[掘金](https://juejin.cn/spost/7663056124003385353)）
- 2026-07-18：[第一次真正调用 LLM 后，我看清了 Runtime、SDK 和模型的边界](./articles/2026-07-18-real-llm-call-runtime-sdk-boundary.md)（[掘金](https://juejin.cn/spost/7663456780569215002)）
- 2026-07-19：[模型返回了 JSON，为什么还不能调用工具？Runtime 的结构化输出校验链路](./articles/2026-07-19-structured-output-runtime-validation.md)（[掘金](https://juejin.cn/post/7663687661035290659)）
- 2026-07-20：[模型说要调用工具之后，究竟是谁动手？我用两次真实 API 调用看清 Tool Calling](./articles/2026-07-20-real-tool-calling-two-model-calls.md)（[掘金](https://juejin.cn/post/7664486932710080563)）
- 2026-07-21：[我终于分清了 Agent Loop 的模型上限和工具执行](./articles/2026-07-21-agent-loop-model-limit-and-tool-execution.md)（[掘金](https://juejin.cn/post/7664869898595319846)）
- 2026-07-22：[从一个最小 Runtime Demo 看懂：陌生的 599 为什么不能重试](./articles/2026-07-22-provider-adapter-error-recovery.md)（[掘金](https://juejin.cn/spost/7664899557906907151)）
- 2026-07-23：[从单文件 CLI Demo 看清 Agent Runtime 的边界](./articles/2026-07-23-cli-agent-runtime-boundaries.md)（[掘金](https://juejin.cn/spost/7665594166467264552)）
- 2026-07-27：[我以为 SSE 渲染就是 Agent 流式，直到它停在用户确认前](./articles/2026-07-27-agent-streaming-runtime-boundaries.md)（[掘金](https://juejin.cn/post/7666646110230118440)）
- 2026-07-28：[Agent 的人工确认为什么必须由 Runtime 接管？](./articles/2026-07-28-agent-runtime-human-confirmation.md)（[掘金](https://juejin.cn/spost/7667039109766938639)）
- 2026-07-29：[我以为用了向量检索就是 RAG，直到我追完了检索结果的去向](./articles/2026-07-29-rag-retrieval-chunk-index.md)（[掘金](https://juejin.cn/spost/7667559681464975360)）
- 2026-07-30：[RAG 回答错了，问题到底出在召回、重排，还是生成？](./articles/2026-07-30-rag-retrieval-rerank-evaluation.md)（[掘金](https://juejin.cn/post/7668156693868970038)）
- 2026-08-01：[意图识别之后，Agent 到底该怎么做？我用报销流程理解 Router、Workflow 与 Agent](./articles/2026-08-01-workflow-router-agent-boundaries.md)（[掘金](https://juejin.cn/post/7668619119231025194)）
- 2026-08-03：[Agent 卡在人工确认时，重启后怎么继续？我用检查点和 LangGraph 看懂状态恢复](./articles/2026-08-03-agent-state-checkpoint-langgraph.md)（[掘金](https://juejin.cn/spost/7669644245594914857)）
- 2026-08-04：[我写过 MCP Server，却一直以为 MCP 只有 Tool](./articles/2026-08-04-mcp-primitives-transport-trust-boundary.md)（[掘金](https://juejin.cn/spost/7669999915607982134)）
- 2026-08-05：[从 MCP 原理到真实 Server：我把 Tool、Resource、Prompt 和错误边界跑通了](./articles/2026-08-05-mcp-server-tool-resource-prompt-errors.md)（[掘金](https://juejin.cn/spost/7670080969732423690)）
- 2026-08-06：[Agent 已经能跑起来了，我却不知道怎样判断它好不好](./articles/2026-08-06-agent-eval-guardrails-trace.md)（[掘金](https://juejin.cn/spost/7670798157669335086)）
- 2026-08-06：[我没有自研 AI 中转站：8 小时跑通 New API、DeepSeek 与 Codex Coding Plan](./articles/2026-08-06-ai-gateway-new-api-cliproxyapi.md)（[掘金](https://juejin.cn/spost/7670720234002284595)）
- 2026-08-10：[Agent 已经能测、能追踪了，我才发现这还不等于能上线](./articles/2026-08-10-agent-production-runtime.md)（[掘金](https://juejin.cn/spost/7671897072309157903)）
<!-- article-index:end -->

## 内容状态

- 文章是学习过程中的阶段性理解，会随着实践继续修订。
- 涉及代码和工程结论时，以实际运行、测试和项目证据为准。
- 掘金等平台发布后，会尽量补充公开链接。

## 关于

目标不是堆积资料，而是留下：

- 我真正理解了什么；
- 哪些认识经过了实践；
- 哪些判断后来被推翻；
- AI 主导开发时，人应该如何保持判断和验收能力。
