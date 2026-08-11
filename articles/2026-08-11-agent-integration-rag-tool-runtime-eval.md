# 我能解释 RAG、MCP 和 Eval，却画不出一条完整的 Agent 链路

过去几周，我一直在沿着 Agent 的运行链路学习。

最开始，我分不清 LLM 和 Runtime；后来又陆续学习了 Tool Calling、错误恢复、RAG、Workflow、Checkpoint、MCP、Eval、Guardrails、Trace，以及上一篇文章中的生产化保护。

如果单独问我这些概念，我大多已经能解释：

- RAG 用来检索外部知识；
- Tool 用来读取实时数据或执行动作；
- MCP 可以向 Host 暴露 Tool、Resource 和 Prompt；
- Runtime 负责校验、权限、状态和执行；
- Eval 用来衡量 Agent 是否符合预期；
- Trace 记录 Agent 实际走过的链路。

但前几天有一道题让我很难受：

> 如果现在让你从用户输入开始，按顺序设计一个完整 Agent，并说明每一步为什么存在、应该记录什么、失败以后怎样处理，你能不能马上画出来？

我发现自己做不到。

不是完全不会，而是不够快，也不够直观。脑中有很多正确的局部知识，但它们还没有连成一条可以随时重建的链路。

所以今天我没有继续学习新名词，而是把前面几周的内容放进同一个 Demo，看看一个任务究竟怎样从“用户说了一句话”，走到“系统真的完成了动作”。

## 一个看起来很简单的学习助手任务

今天的 Demo 处理这样一个任务：

```text
查询 Runtime 回滚知识
→ 告诉我当前学到第几章
→ 发送学习总结
```

这句话看起来不复杂，却包含了三种性质完全不同的需求：

1. Runtime 回滚是知识问题；
2. 当前学习进度是实时状态；
3. 发送总结会产生外部副作用。

如果只描述成“把问题交给 LLM，LLM 需要时调用工具”，很多关键边界都会被藏起来。

知识从哪里来？当前进度是不是真的？模型凭什么能发送？用户有没有授权？最后怎样证明它没有伪造来源，也没有偷偷执行？

我开始沿着这几个问题，一段一段把链路接起来。

## RAG 给模型内容，也要给系统证据

第一步是查询 Runtime 回滚知识。

Demo 中的最小检索器命中知识后，会同时返回 `context` 和 `sources`：

```js
return {
  status: "found",
  context: top.document.content,
  sources: [top.document.sourceId]
};
```

以前我更关注 `context`，因为那是 LLM 最终用来生成回答的内容。

今天我才真正把 `sources` 放回完整链路中理解：它不是为了让回答看起来更像一篇论文，而是检索阶段留下的证据。

如果只把 `context` 交给模型，再让模型自己补引用，它完全可能生成一个本次根本没有命中的来源。回答内容也许是对的，但系统无法证明引用是真的。

因此，Runtime 应该把本次检索得到的 `sources` 当成引用白名单：最终答案只能引用这次真正命中的来源。

这时我才意识到，RAG 的输出其实服务两个对象：

```text
context → 给 LLM 生成回答
sources → 给 Runtime、Trace 和 Eval 验证证据
```

## “我学到第几章”不能去知识库里猜

第二个需求是查询当前学习进度。

它和前面的知识检索不同。课程进度会变化，而且属于某个具体用户。即使知识库里存在一条“当前学习到 L27”的旧记录，也不能证明它现在仍然正确。

所以这一步需要调用 `get_learning_progress`，从真实状态中读取结果。

这让我重新确认了 RAG 和 Tool 的分界：

> RAG 回答已有资料中写了什么；Tool 回答系统现在是什么状态，或者真正改变外部状态。

这个 Tool 可以是 Runtime 中的本地函数，也可以由 MCP Server 提供。实现方式会变化，但职责关系不会变化：LLM 只能提出调用意图，真正的白名单检查、参数校验、权限判断和执行都在 Runtime。

Demo 还故意测试了一个未注册的 `delete_account`。它会被 Runtime 直接拒绝，而不是靠 Prompt 提醒模型“请不要删除账户”。

## 最危险的不是模型选错工具，而是模型给自己授权

第三个需求是发送学习总结。

读取进度不会改变外部世界，发送却会产生真实副作用。于是 Runtime 在真正调用发送工具以前增加了一道人工确认门：

```js
if (runtimeContext.userConfirmed !== true) {
  return {
    status: "needs_confirmation",
    tool: toolCall.name
  };
}

const delivery = await dependencies.sendLearningSummary(
  toolCall.arguments
);
```

这段代码让我重新思考了一个看似普通的参数：`userConfirmed` 应该由谁管理？

它不能放在模型生成的 `toolCall.arguments` 中。

如果模型可以自己生成 `userConfirmed=true`，那就相当于它既申请执行，又替用户批准执行。用户实际上没有确认，模型却可能因为误判或提示注入越过边界。

因此，模型只能说“我想发送”，不能说“用户已经授权我发送”。

授权必须来自 Runtime 记录的真实交互：

```text
模型提出发送
→ Runtime 发现尚未确认
→ 返回 needs_confirmation
→ 用户真实确认
→ Runtime 才调用发送工具
```

这也让我更具体地理解了为什么 Prompt 只是软约束。

Prompt 可以要求模型“发送前先询问用户”，但它不能百分之百保证模型永远照做。只有 Runtime 在调用外部工具前执行判断，才能保证未授权的副作用不会发生。

## 我把 Eval 和 Trace 混成了同一份记录

链路能够执行以后，还要回答另一个问题：怎样证明它执行正确？

我一开始的说法是“把预期行为都记录下来”。后来才发现，这句话把 Eval 和 Trace 混在了一起。

它们保存的不是同一种东西：

```text
Eval 保存 expected：这条案例原本应该怎样流转
Trace 保存 actual：这次任务实际上怎样流转
评测器比较两者：判断通过、失败或退化
```

例如，Eval 可以预先规定：

- 应该命中哪个来源；
- 应该调用哪个工具；
- 发送前必须人工确认；
- 不允许跨租户读取；
- 输出和 Trace 中不能出现合成敏感标记。

Trace 则记录本次真实命中的来源 ID、工具调用、权限与确认决策、脱敏后的工具状态和最终回答。

这里还有一个安全边界：真实 Token、密码、完整敏感参数不应该为了“方便评测”又被写进 Eval 或 Trace。安全测试可以使用专门的合成 canary，但不能把真实秘密复制进公共证据链。

## 为了写一个安全判断，我连续错了三次

今天真正需要我亲手补全的代码并不多：检查整个 Trace 中是否出现合成敏感 canary。

我第一次直接写成：

```js
const secretSafe = !actualTrace.includes(
  expected.syntheticCanaries
);
```

但 `actualTrace` 是对象，不是字符串；`syntheticCanaries` 又是数组，也不能一次交给 `includes`。

第二次，我先序列化 Trace，再使用 `some`，却在回调里多写了一次取反：

```js
const secretSafe = !expected.syntheticCanaries.some(
  (canary) => !serializedTrace.includes(canary)
);
```

这段代码会把逻辑颠倒：没有出现的 canary 反而可能让安全检查失败，真正出现的 canary 却可能被判为安全。

正确的思路应该先判断“是否存在任一泄露”，再对整体结果取反：

```js
const serializedTrace = JSON.stringify(actualTrace);

const secretSafe = !expected.syntheticCanaries.some(
  (canary) => serializedTrace.includes(canary)
);
```

我把布尔关系改对以后运行测试，又遇到了：

```text
ReferenceError: serializedTrace is not defined
```

因为我使用了这个变量，却漏写了前面的声明。

补上以后，阶段测试终于变成 8/8 通过。完整链路接好以后，最终测试结果是：

```text
10 tests
10 pass
0 fail
```

这几次错误让我意识到：能说出“敏感信息不能泄露”，不等于已经能写出正确、可验证的安全判断。

## 为什么出现两次发送请求，最终只发送了一次？

端到端 Demo 会用同一个任务运行两次：第一次没有人工确认，第二次已经确认。

输出结果是：

```text
确认前：send_learning_summary = needs_confirmation
确认后：send_learning_summary = success
simulatedSendCount = 1
```

我第一次看到 `simulatedSendCount=1` 时，实话实说，仅看代码我并不相信。

因为调用关系分散在不同位置：Demo 中的模拟函数通过闭包保存计数，Runtime 又在另一个文件中判断人工确认。

沿着真正的副作用调用点重新走一遍以后，关系才清楚：

- 未确认分支虽然产生了工具请求，但 Runtime 在调用发送函数前提前返回，计数仍然是 0；
- 已确认分支才真正调用一次发送函数，计数从 0 变成 1；
- 闭包只负责保存计数，真正阻止第一次发送的是 Runtime 的人工确认门。

这段代码把一个很重要的区别暴露了出来：

> Trace 中出现 Tool Call，不等于外部副作用已经发生。

如果系统真的在发送邮件、创建订单或扣款，还需要继续记录工具结果、外部操作 ID、幂等键以及 `sideEffectCommitted`，才能判断动作究竟有没有发生。

## 换成采购助手以后，这条链路还能不能用？

为了避免自己只是记住了学习助手 Demo，我又把它迁移到另一个场景：

```text
查一下公司的电脑采购规则
→ 看看当前库存和价格
→ 如果合适，替我下单 10 台
```

我给出的处理方式是：

1. 公司采购规则是相对静态的知识，先走 RAG，并保留真实来源；
2. 库存和价格是实时状态，通过 Tool 查询；
3. Runtime 根据规则和实时结果形成候选下单动作；
4. 下单会产生付费副作用，必须停下来等待用户真实确认；
5. 用户拒绝就终止，用户确认后才执行；
6. Trace 保存租户、来源、权限、确认决策和脱敏后的执行状态；
7. Eval 比较预期与实际，检查是否跨租户、伪造引用或未经授权执行。

工具名称和业务数据都变了，但 Agent 的职责边界没有变。

这次迁移也让我第一次感觉到，前面那些分散的概念正在变成一套可以复用的设计顺序。

## 现在让我重新画一次完整链路

今天以后，如果再让我从头梳理一个 Agent，我会先沿着下面这条线追问：

```text
用户输入
→ Runtime 确认任务身份和租户边界
→ RAG 检索知识并保留 sources
→ LLM 基于允许的上下文提出回答或 Tool Call
→ Runtime 校验 Schema、白名单、权限和参数
→ 高风险动作等待真实人工确认
→ Tool 执行并返回结构化结果
→ Runtime 保存脱敏 Trace
→ LLM 基于工具结果生成最终回答
→ 评测器比较 Eval expected 与 Trace actual
→ 根据错误类型、副作用状态和幂等信息决定重试、人工介入或终止
```

这不是所有 Agent 都必须照抄的固定模板。

纯问答任务可能没有 Tool，确定性 Workflow 也可能不让 LLM 自由规划，某些 MCP Server 只需要提供 Resource。

但这条顺序至少能让我持续追问五件事：

```text
信息从哪里来？
谁做出决策？
谁真正执行？
硬边界在哪里？
什么证据能证明它真的发生了？
```

相比再记住一个新的框架名称，这五个问题对我更有用。

## 完整 Demo

本文对应的完整案例：

[AI 学习助手整合 Demo](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-11-ai-learning-assistant-integration)

运行测试：

```bash
node --test
```

运行端到端演示：

```bash
node demo.mjs
```

实际核验结果：

```text
10 tests
10 pass
0 fail
```

这个 Demo 没有连接真实 LLM、向量数据库、MCP Server 或邮件服务。它使用关键词检索和本地模拟依赖，把结构化任务直接交给 Runtime，只用于让 RAG、工具白名单、人工确认、Trace 和 Eval 的边界变得可见、可测试。

它不能被描述为一套可以直接上线的生产 Agent。

## 最后

过去几周，我一直在逐个理解 Agent 的零件。

直到今天我才意识到，真正缺少的不是另一个新概念，而是随时从用户输入出发，把这些零件重新放回完整任务的能力。

我现在对“学会一个 Agent 概念”的理解也发生了一点变化：

> 不只是能解释它的定义，而是能说清它在完整链路中接收什么、输出什么、信任什么、阻止什么，以及用什么证据证明它确实按预期工作。

下一步，我不准备继续给这条链路增加新零件。

我要先把这个 Demo 整理成别人十分钟内能够理解并运行的交付物，再尝试脱离笔记，把整条链路独立复述出来。