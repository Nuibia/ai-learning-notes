# 第一次真正调用 LLM 后，我看清了 Runtime、SDK 和模型的边界

> 掘金发布地址：[https://juejin.cn/spost/7663456780569215002](https://juejin.cn/spost/7663456780569215002)

昨天我写了一篇文章：[《从 messages 看懂 Agent 的工具调用循环：Runtime 如何衔接模型与工具》](https://juejin.cn/spost/7663056124003385353)。

那篇文章最后，我给自己留下了一个下一步：

> 把教学 Runtime 中的抽象链路放进真实模型 API，观察一次真正的请求和响应。

因为之前使用的 `minimal-agent-runtime` 虽然能够运行和测试，但它的 `model.decide()` 是模拟的。模型返回什么，实际上由测试代码提前写好。

今天，我第一次用 Node.js 真正连接了 DeepSeek API。

我原本以为，这一步只是把模拟的 `model.decide()` 换成一个 SDK 调用。真正顺着请求和响应走过一遍后，我才发现自己对“Runtime 调用模型”这句话的理解还是太笼统。

## 我原本以为：Runtime 通过 SDK 把 messages 发给模型

在开始写请求之前，我脑中的链路是：

```text
Runtime 组装 messages
→ SDK 把 messages 发给服务端
→ LLM 返回 assistant message
```

这个理解大体上没有错，但它把几个不同层次压成了一个词。

当我继续追问“Runtime 到底怎样发请求”时，问题就出现了：Runtime 自己并没有一种叫“连接 LLM”的特殊能力。真正运行 JavaScript、执行网络请求的是 Node.js；真正决定发送哪些 `messages` 的，是应用代码；SDK只是把模型 API 的调用方式封装起来。

如果不用 SDK，同样可以直接使用 `fetch`：

```js
const messages = [
  {
    role: "user",
    content: "请只回复：API 调用成功",
  },
];

const httpResponse = await fetch(
  "https://api.deepseek.com/chat/completions",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages,
      stream: false,
      thinking: { type: "disabled" },
    }),
  },
);

const response = await httpResponse.json();
```

这次我才把原来笼统的 Runtime 继续拆开：

```text
应用代码决定请求内容和 messages
→ Node.js 执行程序和网络请求
→ SDK 或 fetch 按 API 协议发送请求
→ 模型服务完成鉴权、路由和响应包装
→ LLM 根据上下文生成内容
```

SDK可以让连接、输入和输出更统一，但它不自动拥有会话。保存历史、决定下一轮发送什么，仍然是应用或 Agent Runtime 的工作。

## 第一次请求没有调用到 LLM

我的第一次真实请求返回了 `401`。

我一开始关心的是模型会返回什么，实际却连模型都没有调用到。原因是 Node.js 程序没有正确取得 API Key，请求在 DeepSeek 服务端的鉴权阶段就被拦截了。

这次失败反而让我第一次通过真实错误看清了调用边界：

```text
Node.js 发出请求
→ 模型 API 服务鉴权失败
→ 请求结束
→ LLM 没有被调用
```

所以，以后看到模型 API 报错，不能笼统地说“LLM 出错了”。

错误可能发生在：

- 本地程序没有正确读取配置；
- 网络请求没有成功到达服务端；
- API Key 鉴权失败；
- 请求体不符合接口要求；
- 服务端没有成功调用模型；
- 模型已经调用，但生成结果不符合预期。

这些错误都可能出现在同一条调用链上，但它们不是同一层的问题。

## 第一次看到真实的模型响应

修正 API Key 的读取后，请求成功了。

我要求模型只回复“API 调用成功”，真正读取内容的位置是：

```js
response.choices[0].message.content
```

这次响应的核心内容可以简化为：

```js
{
  choices: [
    {
      message: {
        role: "assistant",
        content: "API 调用成功",
      },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 12,
    completion_tokens: 4,
    total_tokens: 16,
  },
}
```

以前在教学 Runtime 中，我自己定义过类似这样的结果：

```ts
{
  type: "final",
  content: "API 调用成功",
}
```

但真实 DeepSeek API 不会返回我在教学代码中定义的 `final`。它返回的是 Chat Completion 对象，最终内容位于 `choices[0].message.content`，停止原因位于 `choices[0].finish_reason`。

这也让我重新区分了两件事：

- `assistant message` 是模型在对话中生成的消息；
- `choices`、`finish_reason`、`usage` 是 API 服务包装在消息外面的响应信息。

LLM 负责生成内容，但响应对象长什么样，是 API 协议的一部分。

DeepSeek 当前的[Chat Completion 文档](https://api-docs.deepseek.com/api/create-chat-completion)也把非流式响应定义为一个完整的 Chat Completion 对象，其中包含 `choices`、`message`、`finish_reason` 和 `usage`。

## 多轮对话是谁保存的？

第一次请求成功后，我又发起了第二轮：

```js
const messages = [
  {
    role: "user",
    content: "请只回复：API 调用成功",
  },
  {
    role: "assistant",
    content: "API 调用成功",
  },
  {
    role: "user",
    content: "再回复一次",
  },
];
```

这里不是只发送“再回复一次”，而是把上一轮的 `user` 和 `assistant` 消息一起重新发送。

我昨天通过教学代码理解了“模型只能看到本次请求实际传给它的内容”。今天真实调用后，这个判断得到了进一步验证：API不会因为我在同一个程序里请求过一次，就自动替我补齐上一轮上下文。

多轮对话的连续性来自：

```text
应用保存历史消息
→ 下一轮重新组装 messages
→ 再次发送完整上下文
```

第二次请求中，`prompt_tokens` 从 12 增加到了 23。

上下文变多，输入 Token 也随之增加。这就是多轮对话成本会继续上升的一个直接原因：模型每一轮都需要重新处理这次请求中携带的上下文。

## `stop` 和 `length` 让我看到了两种结束

第一次请求的：

```js
response.choices[0].finish_reason
```

返回的是：

```text
stop
```

我最开始只能盲猜它表示“本轮对话结束”。结合真实响应和官方文档后，我确认它表示模型到达了自然停止点，或者遇到了请求指定的停止序列。

随后，我把 `max_tokens` 设为 1，并要求模型生成一段更长的内容。结果只返回了一个 Token，`finish_reason` 变成：

```text
length
```

这次结果说明：即使 HTTP 请求成功，也确实拿到了 `message.content`，内容仍然可能因为 Token 上限而被截断。

所以应用不能只读取：

```js
response.choices[0].message.content
```

还应该检查：

```js
response.choices[0].finish_reason
```

否则，程序可能把一段没有生成完的内容当成完整答案继续处理。

DeepSeek 当前文档还列出了 `content_filter`、`tool_calls` 和 `insufficient_system_resource` 等结束原因，但今天我只实际验证了 `stop` 和 `length`。

## 非流式返回，不等于每次生成相同内容

这次请求使用了：

```js
stream: false
```

它表示程序等待模型生成完成后，一次性接收整个响应，而不是逐段接收流式数据。

但这不会让 LLM 变成一个普通的确定性函数。

LLM 每生成一个 Token，都会基于当前上下文计算候选 Token 的概率。温度等参数会影响随机程度，但相同的 `messages` 并不天然保证每次得到逐字相同的 `content`。

如果目标特别明确，例如：

```text
请只回复：API 调用成功
```

模型更可能返回相同内容，但“更可能一致”不等于接口承诺“一定一致”。

这也意味着，应用不能把普通自然语言结果当成永远稳定的程序常量。如果后续代码依赖固定结构，还需要结构化输出、Schema 校验、失败处理和必要的重试策略。

## 我今天真正学会了什么？

前几天，我已经知道 Runtime 会组装 `messages`、调用模型并维护循环，但这个认识仍然停留在教学代码中。

今天第一次连接真实 LLM 后，我把这条链路继续拆细了：

```text
应用代码组装 messages
→ Node.js 执行程序
→ SDK 或 fetch 发送请求
→ API 服务鉴权并调用模型
→ LLM 概率生成内容
→ API 服务包装响应
→ 应用读取结果并决定下一步
```

我现在更清楚：SDK保证的是连接和接口适配，不会替应用维护完整对话；LLM负责生成内容，不会替Runtime保存历史；`stream: false` 决定的是返回方式，不决定生成结果是否一致。

今天最值得留下的，不是记住 DeepSeek 的某几个字段，而是当一次模型调用出问题时，我终于知道应该继续追问：

```text
是应用组装错了 messages？
是 Node.js 没有正确发送请求？
是 SDK 或接口参数不匹配？
是服务端鉴权失败？
还是 LLM 已经生成，但结果不符合程序预期？
```

下一步，我会继续学习结构化输出和 Schema 校验：当模型返回的内容不符合预期时，应该在哪一层拒绝、修复、重试或终止。
