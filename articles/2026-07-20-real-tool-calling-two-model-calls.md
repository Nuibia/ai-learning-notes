# 模型说要调用工具之后，究竟是谁动手？我用两次真实 API 调用看清 Tool Calling

前几天学习 Agent Runtime 时，我已经知道一条简化链路：

```text
user
→ assistant(tool_call)
→ tool(result)
→ assistant(final)
```

今天没有学习一个完全陌生的概念，而是把这条骨架放到一次真实的 DeepSeek Tool Calling 记录中，确认它在真实 API 里究竟如何发生。

这次最重要的收获不是记住几个字段，而是看清：**一个用户任务、两次模型 API 调用和一次本地工具执行，是三种不同层次的事件。**

## 一次用户请求，为什么需要调用模型两次？

实验中的用户问题是：

> 请查询当前日期和时间，并严格根据工具结果用一句中文回答。

Runtime 在第一次请求中提交了用户消息和工具描述：

```js
{
  name: "get_current_datetime",
  description: "Return the current date and time in Asia/Shanghai.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  }
}
```

这里的 `tools` 不是上传给模型执行的 JavaScript 函数，而是一份接口说明书：告诉模型有哪些工具可以请求、函数叫什么、参数应该是什么结构。

为了让实验稳定进入工具阶段，第一次请求通过 `tool_choice` 强制指定了 `get_current_datetime`。

第一次响应的关键字段是：

```text
finish_reason: tool_calls
assistant.content: ""
tool call id: call_00_gyKjk1WDe5IVOudqvJWW5446
function.name: get_current_datetime
function.arguments: "{}"
```

这时模型没有返回真实时间，也没有执行本地函数。它只生成了一个结构化调用意图。

## 真正执行工具的是 Runtime

Runtime 收到 tool call 后，需要先做确定性处理：

1. 确认函数名在允许列表中；
2. 将 `arguments` 从 JSON 字符串解析成对象；
3. 按 Schema 校验参数；
4. 调用本地函数；
5. 保存结果与原调用之间的关联。

本次参数是空对象，校验通过。本地 Node Runtime 执行函数后得到：

```json
{
  "timezone": "Asia/Shanghai",
  "local": "2026/07/20 21:10:15"
}
```

随后 Runtime 生成工具结果消息：

```js
{
  role: "tool",
  tool_call_id: "call_00_gyKjk1WDe5IVOudqvJWW5446",
  content: "{\"timezone\":\"Asia/Shanghai\",\"local\":\"2026-07-20 21:10:15\"}"
}
```

`tool_call_id` 的作用，是明确告诉下一次模型调用：这条结果对应哪一个工具请求。

如果只回填结果、不保留原来的 assistant tool call，或者使用了错误的调用 ID，因果链就不完整。

## 第二次模型调用看到了什么？

模型 API 是无状态的。第二次调用不会自动记得第一次发生了什么，Runtime 必须重新提交完整消息历史：

```text
user
→ assistant(tool_call)
→ tool(result)
```

这次实验把第二次请求的 `tool_choice` 设置为 `none`。

我一开始对这里有疑问：既然应该由 LLM 识别意图，为什么 Runtime 要设置 `none`？

后来我分清了两个层次：

- LLM 负责在允许范围内识别意图并生成候选动作；
- Runtime 负责定义本次调用允许模型选择哪些动作。

`tool_choice: "none"` 不是告诉模型“工具没有执行”，而是告诉模型：

> 已经回填了工具结果，本次不要再产生新的 tool call，请根据现有上下文生成普通回答。

因此第二次响应是：

```text
finish_reason: stop
content: 当前日期和时间是2026年7月20日21:10。
```

这里的 `stop` 也不是模型向 Runtime 下达的停止命令。它只是 API 返回的生成结束原因，表示本次模型生成自然结束。

Runtime 仍需结合 `content` 和应用规则，判断结果能否交给用户。

## 我在 trace 还原中纠正了什么？

第一个错误，是把空的 `assistant.content` 当成最终答案。

真实记录里，第一次响应虽然 `content` 为空，但同时存在：

```text
finish_reason: tool_calls
message.tool_calls: 非空
```

因此 Runtime 必须进入工具分支，不能返回空字符串。

第二个错误，是只理解了消息顺序，却没有写对精确字段。

我最初写的伪代码缺少：

- `assistant.tool_calls[]`；
- `tool.tool_call_id`；
- 字符串形式的 `function.arguments`；
- 字符串形式的 `tool.content`。

第三个错误，是混淆请求侧控制和响应侧观察：

- `tool_choice` 由 Runtime 在请求模型之前设置；
- `finish_reason` 由模型 API 在响应中返回。

第四个错误，是把 `stop` 理解成整个会话结束。

更准确的说法是：

- `stop` 表示本次模型生成结束；
- Runtime 可以据此结束当前任务；
- 用户仍然可以继续聊天，触发新的模型调用。

## 一次任务不等于一次模型调用

这次 trace 中存在两个不同的响应 ID，也有两组独立的 token 用量：

```text
调用 1：318 tokens
调用 2：125 tokens
```

中间的本地工具执行没有模型响应 ID，也没有独立的模型 `usage`，因此它不是第三次模型调用。

但工具结果被写入第二次请求后，会成为模型输入上下文的一部分，进而影响第二次调用的输入 token。

因此本次记录可以准确总结为：

```text
一次用户任务
= 两次模型 API 调用
+ 一次本地工具执行
```

## 哪些理解可以迁移，哪些不能照搬？

可以迁移的是控制链路：

```text
模型生成行动请求
→ Runtime 校验与执行
→ 结果关联原调用
→ Runtime 回填结果
→ 模型生成最终回答
```

不能直接照搬的是供应商字段。

本次使用的是 DeepSeek Chat Completions 风格契约。换成另一家模型 API 后，字段名、并行调用方式、结束原因和额外状态回传要求都可能不同。

例如，本次显式关闭了 DeepSeek thinking mode，是为了避免把 `reasoning_content` 的回传规则混入当前实验。这不代表 Tool Calling 必须关闭思考模式。

## 这次学习仍然缺少什么？

这次真实 API 脚本由 AI/Node Runtime 执行。我完成的是：

- 阅读真实 trace；
- 预测第一次响应；
- 还原两次模型调用；
- 尝试编写第二次请求的消息伪代码；
- 根据字段和职责反馈完成纠正。

我没有亲自运行这份真实脚本，也没有提交代码或 Git 记录。因此，我能够解释链路，但还不能把它描述成独立实现经验。

下一步进入完整 Agent Loop 时，应该减少重复判断题，把亲手操作放到前面：由我自己运行或修改最小脚本，再观察 `final`、工具成功和循环上限三条路径。

---

参考资料：

- [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)
- [DeepSeek Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)