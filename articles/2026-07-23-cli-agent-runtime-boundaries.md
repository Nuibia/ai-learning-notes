# 从单文件 CLI Demo 看清 Agent Runtime 的边界

今天我没有直接上 LangChain、LangGraph 或 Mastra，而是先用一个单文件 TypeScript CLI Demo，把 Agent Runtime 的最小边界拆开看了一遍。

完整可运行 Demo 将发布在：[2026-07-23-cli-agent](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-07-23-cli-agent)。

## 这个 Demo 不是真实 LLM 调用

先说明边界：Demo 里的 `decide()` 是确定性函数，不会请求真实模型 API；`callId` 也是 Demo 自己定义的关联字段，不是某个 SDK 的原生 `tool_call_id`。

我这样做是为了先隔离最小问题：模型阶段或决策阶段只表达“想调用什么工具”，而 Runtime 负责是否允许、是否执行，以及怎样结束这次请求。

因此，Demo 证明的是 Runtime 的控制结构，不是某一家模型 API 的完整工具调用协议。

## 决策、执行和权限不应混在一起

`decide()` 只输出两类结果：

- `final`：直接结束；
- `tool_call`：提出工具名称、参数和 `callId`。

接下来由 `receive()` 接管。它负责：

1. 判断当前是否已经确认；
2. 判断角色是否允许；
3. 调用对应的本地模拟工具；
4. 根据工具结果继续到最终回复，或结束在错误/拒绝状态。

这让我更明确地区分了三件事：

- 决策：模型或决策函数认为应调用什么；
- 授权：本次操作是否被确认、角色是否满足规则；
- 执行：工具是否真的被 Runtime 调用。

模型提出工具意图，不代表它已被授权，也不代表工具已执行。

## `callId` 在 Demo 和真实 API 中分别代表什么

这个 Demo 用 `callId` 把一次工具意图和对应工具结果关联起来。例如，`create demo` 会产生 `call-3`。

不过，Demo 的后续处理是直接函数调用：

```ts
const output = receive(decide(userInput), confirmed, role);

if (output.event === "tool.result") {
  const finalOutput = continueAfterTool(output.detail);
}
```

它没有维护真实的 `messages` 数组，也没有把消息再发给真实 LLM。

在真实工具调用 API 中，同一个问题通常会表现为：Runtime 保留 assistant 发起工具调用的消息，再追加携带相同 `tool_call_id` 的工具结果消息。下一轮模型看到这组配对历史，才知道上轮请求的工具是否成功、失败或未执行。

所以更准确的理解是：

- Demo 的 `callId`：演示“工具意图和结果必须可关联”的思想；
- 真实 API 的 `tool_call_id`：通常用于关联调用消息与工具结果消息；
- 二者的共同点：关联键不是模型的记忆本身，完整的上下文历史才是。

## 确认与角色权限是两道独立的门

Demo 对 `create_project` 的处理如下：

```ts
if (confirmed) {
  if (role !== "editor") {
    return { event: "tool.refused", detail: { code: "ROLE_VIEWER" } };
  }
  return { event: "tool.result", detail: createProject(...) };
}

return { event: "runtime.confirmation_required" };
```

这里还有两个边界需要说清：

第一，`createProject()` 只是返回项目名，并没有真正写数据库或文件。因此它模拟的是“写入型工具意图被允许执行”，不是一个真实持久化创建动作。

第二，角色模型是简化的二元规则：只有 `editor` 被允许，任何非 `editor` 都返回 `ROLE_VIEWER`。它不是完整的 RBAC 系统。

我此前以为“无权限角色应该优先被拒绝”。但这个 Demo 选择了另一种顺序：

- 未确认：先返回 `confirmation_required`；
- 已确认但不是 editor：返回 `ROLE_VIEWER`；
- 已确认且是 editor：才执行模拟创建。

这不是行业唯一标准。确认门与权限门谁先检查，属于 Runtime 的产品与安全策略；真正不变的是：确认不等于权限，权限也不等于本次操作已获确认。

## 五条路径如何结束

我实际运行并观察了五条路径：

| 输入与条件 | 结果 |
| --- | --- |
| `list projects` | `tool.result → model.final → runtime.completed` |
| `get missing` | `PROJECT_NOT_FOUND → runtime.terminal` |
| `create demo` | `confirmation_required → AWAITING_USER_CONFIRMATION` |
| `create demo --confirm --role=viewer` | `ROLE_VIEWER → runtime.terminal` |
| `create demo --confirm`，默认 editor | 模拟创建成功后 `tool.result → model.final → runtime.completed` |

这让我看到一个清晰边界：`tool.error`、`tool.refused` 与 `confirmation_required` 都不应伪装成 `model.final`。Runtime 应显式地终止或进入等待确认状态，让调用方知道这次调用到底处于什么位置。

## 这套“跟着 AI 学 AI”算 Agent 吗？

今天回头看本地学习系统，我的判断是：算一个有明确领域边界的简单 Agent Runtime。

它维护学习目标和状态，使用模型参与决策，调用受控工具，并在人工确认点暂停、继续或结束。是否使用 LangChain、LangGraph 或 Mastra，并不是它成为 Agent 的前提；这些框架更像是实现状态、事件、工具编排的工程工具。

下一步我想在后续实践中选择一个框架，只映射当前 Runtime 的一个最小状态或事件流，而不是一次性重写整个 Demo。这样才能看清框架究竟减少了什么工作，又带来了哪些复杂度。