# Agent 能跑通以后，我才发现代码不是交付物

上一篇文章《我能解释 RAG、MCP 和 Eval，却画不出一条完整的 Agent 链路》的最后，我给自己留了一个任务：

> 把 Demo 整理成别人十分钟内能够理解并运行的交付物，再尝试脱离笔记，独立复述整条 Agent 链路。

当时我觉得这件事应该不难。

Demo 已经能运行，10 条测试全部通过，README 里也有运行命令。只要再整理一下文档，应该就算完成了。

但真正开始检查以后，我才发现：

> Agent 能运行，只能证明开发者自己把它跑通了；不能证明另一个人能够接手，更不能证明他知道哪些结果值得相信。

## 从上一篇文章留下的 Demo 开始

上一篇文章中的 AI 学习助手处理了一个组合任务：

```text
查询 Runtime 回滚知识
→ 获取当前学习进度
→ 发送学习总结
```

它把前面几周学习的多个概念放进了同一条链路：

```text
用户输入
→ Runtime 接收任务
→ RAG 检索知识并保留来源
→ 查询真实学习进度
→ 形成发送总结的 Tool Call
→ Runtime 检查工具白名单和人工确认
→ Tool 返回结构化结果
→ Runtime 生成脱敏 Trace
→ Eval 比较预期与实际
```

其中，发送学习总结会产生外部副作用。

因此，未确认时 Runtime 只能返回：

```text
needs_confirmation
```

只有用户真正确认后，Runtime 才允许发送函数执行。

从开发视角看，这条链路已经比较完整。但如果把项目直接交给另一个人，他仍然需要自己回答很多问题：

- 入口在哪里？
- 先运行哪个命令？
- RAG、Tool 和 Runtime 分别负责什么？
- 为什么会调用两个 Tool？
- `needs_confirmation` 是模型返回的，还是 Runtime 的硬判断？
- Trace 中出现 Tool Call，是否代表副作用已经发生？
- 测试通过能够证明什么，又不能证明什么？

如果这些问题只能靠阅读 `runtime.mjs` 才能回答，这个 Demo 还不能算真正完成了交接。

## 今天新产出了一个交付检查 Demo

今天并不是只对昨天的代码做了一次口头复盘。

我新建了一个独立的交付检查 Demo：

[Agent 交付检查 Demo](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-12-agent-delivery-review)

它不会修改昨天已经跑通的 Agent 快照，而是在外面增加一层交付说明和可执行检查：

```text
昨天的 Agent 集成 Demo
├── runtime.mjs
├── demo.mjs
└── runtime.test.mjs

今天的交付检查 Demo
├── README.md
├── ARCHITECTURE.md
├── EVAL_REPORT.md
├── LIMITATIONS.md
└── delivery-check.mjs
```

两个 Demo 承担不同职责：

- 昨天的 Demo 回答“Agent 链路能不能运行”；
- 今天的 Demo 回答“另一个人能不能理解、运行并判断它”。

今天的 `delivery-check.mjs` 会同时读取两个目录：

- 从昨天的目录确认演示脚本是否存在；
- 从今天的目录检查 README、架构说明、Eval 报告和限制说明是否完整。

运行方式是：

```bash
cd examples/2026-08-12-agent-delivery-review
node delivery-check.mjs
```

这意味着今天的产出不只是几份补充文档，而是给昨天的 Agent 增加了一个可执行的交付验收层。

它把原本模糊的判断：

```text
这个项目看起来应该可以交接
```

变成结构化结果：

```json
{
  "ready": false,
  "missing": [
    {
      "id": "limitations-roadmap",
      "label": "限制与后续路线"
    }
  ]
}
```

检查器不能判断文档写得是否真正准确，也不能代替学习者脱离笔记复述，但它至少能够避免交付缺项被悄悄忽略。

## 架构说明回答：这个系统到底怎样工作

以前我容易把 README 和架构说明混在一起。

README 可以告诉接手者怎样运行：

```bash
node demo.mjs
node --test
```

但它不一定能解释系统为什么这样设计。

架构说明需要让接手者在不通读 Runtime 的情况下，先看到主链路：

```text
用户输入
→ Runtime
→ 知识检索
→ context + sources
→ 查询学习进度
→ 形成发送动作
→ userConfirmed 硬门槛
→ needs_confirmation 或真实发送
→ 脱敏 Trace
→ Eval
→ 最终结果
```

它还需要说明职责边界：

- LLM 负责语义理解和提出行动；
- Runtime 负责流程、白名单、确认门和执行控制；
- RAG 提供知识内容和真实来源；
- Tool 读取实时状态或改变外部系统；
- Trace 保存实际发生的关键事件；
- Eval 定义预期并判断实际结果。

架构说明解决的不是“代码放在哪里”，而是：

> 接手者应该用什么心智模型阅读这套代码。

## Eval 报告回答：我凭什么相信它

架构图只能说明系统准备怎样运行，不能证明它真的按预期运行。

因此，交付材料还需要一份人能阅读的 Eval 报告。

这里最重要的仍然是我前面学过的区分：

```text
Eval 定义 expected
Trace 保存 actual
评测器比较 expected 和 actual
```

例如，未确认发送的案例可以定义为：

```text
userConfirmed = false
预期状态 = needs_confirmation
预期发送次数 = 0
```

如果实际 Trace 是：

```text
response = needs_confirmation
simulatedSendCount = 1
```

这条案例仍然必须失败。

因为最终文案虽然写着“等待确认”，真实副作用却已经发生了。

这也让我再次确认：

> 判断 Agent 是否安全，不能只看它说了什么，还要看 Runtime 和 Tool 实际做了什么。

因此，Eval 报告至少要让接手者看到：

- 哪些代表性案例被验证；
- 每条案例的关键预期是什么；
- 实际 Trace 中观察了哪些字段；
- 准确性和安全性是否同时通过；
- 哪些生产风险尚未覆盖。

框架能够自动记录 Trace，并不等于项目已经有了有效的 Eval。

Trace 解决“发生了什么”，业务 Eval 才定义“这样算不算正确”。

## 我又一次把生产要求补进了自己的理解

在脱离笔记复述 Demo 时，我说了几件“生产环境应该存在”的能力：

- `needs_confirmation` 应该持久化，避免重开会话后状态错乱；
- Runtime 应该检查当前用户是否拥有工具权限；
- RAG 没有命中时应该停止后续流程。

这些设计思路本身有价值，但重新核对代码以后，我发现当前 Demo 并没有完整实现它们：

1. 检索没有命中时，Demo 会返回“没有找到相关知识”，但仍继续查询学习进度并进入发送确认流程；
2. `userConfirmed` 只是两次运行时分别传入，没有实现跨会话持久化；
3. Runtime 实现了工具白名单和人工确认门，没有实现真实身份认证与用户权限系统。

这和我最早学习 Runtime 时遇到的问题非常相似。

AI 生成代码以后，人很容易把下面几层混在一起：

```text
我希望系统具备什么
设计上应该存在什么
代码当前实现了什么
测试实际证明了什么
```

交接材料的一个重要作用，就是强迫我们把这几层重新分开。

否则，开发者会把脑中的设计自动补进代码，接手者又会把文档中的描述误认为已经通过验证。

## 这套交付清单是社区标准吗？

学习过程中，我还追问了一个问题：

> README、架构图、Demo、Eval 报告和限制说明，是某套社区规范，还是为了这门课临时创造的？

最后核对得到的答案是：

**它不是统一的 Agent 社区标准，而是这门课程组合出来的教学验收模板。**

其中的组成部分都有成熟实践依据：

- README、架构说明、运行入口和限制说明，来自常见的软件工程交接实践；
- Trace、Dataset、Grader 和 Eval Run，属于 Agent 评测中的常见方法；
- OpenAI 的 [Agent Evals 文档](https://developers.openai.com/api/docs/guides/agent-evals) 同样建议使用 Trace 观察模型调用、工具调用、Guardrail 和 Handoff，再通过评测器与可重复数据集寻找回归和失败模式。

但下面这些具体要求是课程自己的设计：

```text
必须包含哪几个文件
文件叫什么名字
别人是否能在十分钟内理解并运行
学习者是否能脱离笔记复述
```

这个边界很重要。

如果把课程模板说成行业标准，我就会再次把一个教学工具理解成普遍真理。

真正可以迁移的不是固定文件名，而是四个交付目标：

```text
可理解
可运行
可验证
边界明确
```

## 最后，检查器仍然是 ready=false

补充架构说明和 Eval 报告以后，我再次运行检查器：

```json
{
  "ready": false,
  "missing": [
    {
      "id": "limitations-roadmap",
      "label": "限制与后续路线"
    }
  ]
}
```

我已经能够说出当前 Demo 的限制：

- RAG 是本地关键词匹配；
- 没有真实调用 LLM；
- 没有连接向量数据库；
- 没有连接真实邮件或消息服务；
- 没有实现生产级状态持久化和身份权限系统。

因此，它只能证明本地流程契约，不能证明真实 Agent 的生产可靠性。

但当练习继续要求我把这段话填进 `LIMITATIONS.md`，只是为了让检查器变成绿色时，我选择没有继续写。

因为到这一步，新增操作已经不能继续帮助我理解问题，只是在满足检查器的形式。

这个结果反而让我更具体地理解了交付检查：

> 检查器是帮助人发现缺口的工具，不是项目的最终目标。

`ready=false` 忠实地说明交付包里仍缺一份正式限制文档。概念上我已经知道缺口是什么，但产物上它确实还没有完成。

这两件事可以同时成立。

## 完整 Demo

上一篇的 Agent 集成 Demo：

[AI 学习助手集成 Demo](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-11-ai-learning-assistant-integration)

今天新产出的交付检查 Demo：

[Agent 交付检查 Demo](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-12-agent-delivery-review)

两者连起来分别验证：

```text
Agent 是否能够运行
→ Agent 是否能够被交接
```

## 从“学习零件”走向真实 Agent

这次学习是整套课程的最后一章。

从最开始把 LLM 和 Agent 混在一起，到后来逐步学习 Runtime、Tool Calling、错误恢复、RAG、Workflow、Checkpoint、MCP、Eval、Guardrails、Trace 和生产保护，我一直在补充 Agent 的各个零件。

上一篇文章把这些零件接回了一条完整链路。

今天则继续回答了另一个问题：

> 当这条链路已经能够运行以后，怎样让另一个人理解它、验证它，并知道哪些能力还不能相信？

课程结束以后，我不准备继续增加新的教学 Demo。

下一步，我希望真正实现一个 AI 答疑 Agent：

```text
知识命中
→ 基于真实来源回答

知识未命中
→ 不让 LLM 自由编造
→ 触发升级流程
→ 通过 Tool 给我发送消息或创建待处理任务
```

它不会只是一个套着对话框的 RAG。

它需要真实 LLM、真实知识库、Runtime 控制、未命中分支、外部通知 Tool、Trace 和 Eval。涉及外部副作用时，还要继续判断哪些动作可以按策略自动执行，哪些必须经过人工确认。

在决定使用 Mastra 还是 LangChain 以前，我会先定义三个验收场景：

1. 知识命中时，回答必须引用真实来源；
2. 知识未命中时，必须进入升级流程，不能伪造答案；
3. 敏感操作发生前，必须满足 Runtime 的授权条件。

框架可以更换，但这三个行为契约不会因为框架变化而消失。

## 最后

以前我觉得，一个 Agent 项目做到“能运行、测试通过”，就已经接近完成。

现在我会继续追问：

```text
别人能不能快速理解？
别人能不能独立运行？
别人凭什么相信结果？
哪些能力只是设计目标，还没有被代码和测试证明？
```

Agent 的交付不是把 Runtime 代码交给另一个人。

它真正交付的是一套可以被理解、运行、质疑和验证的系统边界。