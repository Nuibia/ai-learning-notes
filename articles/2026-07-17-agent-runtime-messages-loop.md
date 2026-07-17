# 从 messages 看懂 Agent 的工具调用循环：Runtime 如何衔接模型与工具

> 掘金发布地址：[https://juejin.cn/spost/7663056124003385353](https://juejin.cn/spost/7663056124003385353)

> 完整案例代码：[minimal-agent-runtime](../examples/minimal-agent-runtime/)

前两天的学习中，我先后弄懂了两个问题：

1. LLM 不是 Agent，Runtime 才是承载 Agent 运行的控制层；
2. Tool 执行失败后，Runtime 要区分校验失败、暂时性错误和不可恢复错误。

今天我继续沿着最小 Agent Runtime 阅读代码，但把注意力放在了一个更细的对象上：`messages`。

我以前知道 Runtime 会“维护上下文”，但这个理解比较抽象。真正顺着代码走过一轮之后，我才看清：模型的 Tool Call、工具结果以及最终回答，是怎样通过 `messages` 被 Runtime 串联起来的。

## 先说明：本文中的 Runtime 从哪里来？

本文使用的 [`minimal-agent-runtime`](../examples/minimal-agent-runtime/) 不是某个官方 Agent 框架的源码，而是一个可运行的教学实验。它根据我之前提出的伪代码和约束写成，只允许调用 `read_file`，最多循环三轮，并对暂时性工具错误进行有限重试。读者可以在案例目录执行 `node --test runtime.test.mjs`，观察每条结论对应的测试。

它刻意不连接真实 LLM，也不读取真实文件。它的作用不是让我记住某个厂商的 API 格式，而是把下面这条控制链路显式地展示出来：

```text
用户目标
→ Runtime 组装输入
→ 模型提出 Tool Call
→ Runtime 解析和校验
→ Tool 执行
→ Runtime 回填工具结果
→ 模型继续决策
→ 返回最终答案
```

这条链路是有官方依据的。OpenAI 将 Tool Calling 描述为五个步骤：向模型发送可用工具、接收 Tool Call、由应用程序执行代码、把工具结果再次发送给模型、接收最终回答或新的 Tool Call。

参考：[OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling)

所以，这个教学 Runtime 的抽象方向是成立的；但它使用的类型、角色名称、轮数和重试策略都是示例设计，不能当成所有 Agent 的统一标准。

## messages 不是模型的长期记忆

最小 Runtime 先创建一条用户消息：

```ts
const messages: Message[] = [
  { role: "user", content: goal },
];
```

随后，Runtime 把整个 `messages` 交给模型：

```ts
const rawAction = await model.decide(messages);
```

这段代码让我重新确认了一件很基础、但很重要的事：

> 模型只能看到本次请求实际传给它的内容。

如果第二轮只发送一条新的用户消息，模型不会自动知道上一轮调用过什么工具，也不会自动知道工具返回了什么。

因此，所谓“Agent 记得刚才做过什么”，很多时候并不是模型自己保存了状态，而是 Runtime 保存了消息，并在下一次模型调用时重新发送。

## 第一轮：模型提出行动，Runtime 负责落地

模型可能返回一个 Tool Call：

```ts
{
  type: "tool_call",
  tool: "read_file",
  args: { path: "/knowledge/runtime.md" },
}
```

这里还不能直接执行工具。

模型返回的是外部数据。即使 TypeScript 中定义了 `Action` 类型，也不能证明真实模型返回的 JSON 一定符合这个类型。因此 Runtime 先调用 `parseModelAction`，检查结构、字段和字符串类型：

```ts
const rawAction = await model.decide(messages);
const action = parseModelAction(rawAction);
```

我一开始把 `parseModelAction` 说成了“模型处理”。后来对照代码才发现，职责正好相反：

- 模型生成不稳定的 `rawAction`；
- Runtime 解析并校验 `rawAction`；
- 解析成功后，Runtime 才得到可以继续处理的 `action`。

接下来，Runtime 还要校验工具名称、文件路径和文件类型，然后才真正调用 Tool。

## 工具执行后，为什么要保存两条消息？

工具成功返回结果后，当前 Runtime 依次追加两条消息：

```ts
messages.push({
  role: "assistant",
  content: JSON.stringify(action),
});

messages.push({
  role: "tool",
  content: toolResult,
});
```

加上最初的用户消息，第二次调用模型前，顺序是：

```text
user
→ assistant（模型上一轮提出的 Tool Call）
→ tool（Tool 的执行结果）
```

这两条记录承担不同职责：

- `assistant` 记录模型上一轮想做什么；
- `tool` 记录这个行动实际得到了什么结果。

如果只保存 Tool 结果，不保存模型上一轮提出的行动，模型下一次看到的上下文就会缺少因果关系：它能看到一个结果，却不知道这个结果对应哪次调用。

## Tool 的结果为什么不能直接返回给用户？

假设用户的目标是“读取一个 Markdown 文件并总结”。

`read_file` 只完成了读取，返回的是文件原文。用户真正需要的是总结，所以 Runtime 不能把 Tool 结果直接当作最终答案。

它需要再次调用模型：

```text
Runtime 将完整 messages 发送给模型
→ 模型看到用户目标、Tool Call 和 Tool 结果
→ 模型基于文件内容生成总结
```

如果模型返回：

```ts
{
  type: "final",
  content: "这是文档总结……",
}
```

当前 Runtime 会直接返回：

```ts
if (action.type === "final") {
  return action.content;
}
```

这也纠正了我的另一个误判：`final` 不是错误，而是这条循环的正常结束路径。

## messages 的生命周期

把上面的过程连起来，一次正常的读取与总结流程是：

```text
1. Runtime 接收用户 goal
2. Runtime 创建 user 消息
3. Runtime 把 messages 交给模型
4. 模型返回 rawAction
5. Runtime 解析并校验 action
6. Runtime 校验 Tool Call
7. Tool 执行并返回结果
8. Runtime 追加 assistant Tool Call
9. Runtime 追加 tool result
10. Runtime 再次把完整 messages 交给模型
11. 模型返回 final
12. Runtime 返回 final.content
```

如果模型连续三轮都只提出 Tool Call，没有返回 `final`，当前示例才会在循环结束后抛出 `MAX_ROUNDS_EXCEEDED`。

工具内部还有另一层循环：`maxToolRetries = 2` 表示首次执行失败后最多重试两次，因此最多可能尝试三次。这个工具重试循环和 Agent 的三轮模型决策循环不是一回事。

## 不同模型 API 的消息格式并不统一

今天最需要保留的边界是：通用循环成立，不代表具体角色格式统一。

OpenAI Chat Completions 的官方示例与本文结构接近：

```text
user
→ assistant.tool_calls
→ tool（带 tool_call_id）
→ 再次请求模型
```

但 OpenAI Responses API 使用的是 `function_call` 和 `function_call_output` 等输入项，不一定表现为同一套消息 role。

Claude Messages API 的格式又不同：

- 模型在 `assistant` 消息中返回 `tool_use` 内容块；
- 应用程序使用 `user` 消息中的 `tool_result` 内容块返回结果；
- Claude API 没有使用本文这样的独立 `tool` role。

参考：[Claude Handle Tool Calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)

因此，真正可以迁移的知识是：

> Runtime 必须保存模型的工具调用及其对应结果，并把这些信息交给模型继续决策。

不能直接迁移的是：

> 所有 API 都必须使用 `user → assistant → tool` 这三个 role。

## 我今天真正学会了什么？

以前我只有“Runtime 会组装上下文”的大致概念。今天结合代码，我第一次具体跟踪了 `messages` 在每一轮中如何变化，也看清了模型输出、Runtime 校验、Tool 执行和结果回填之间的顺序。

这次学习是有用的，但它的价值不在于记住这份教学代码，而在于建立一个可以继续验证的心智模型：

```text
模型提出行动
→ Runtime 决定行动能否执行
→ Tool 产生外部结果
→ Runtime 保存并回填结果
→ 模型基于新上下文继续决策
```

下一步，我需要把这条抽象链路放到一个真实模型 API 中验证，观察不同厂商怎样表达 Tool Call 和 Tool Result。只有到那时，我才能把“看懂教学 Runtime”继续推进为“能够接入真实 LLM API”。
