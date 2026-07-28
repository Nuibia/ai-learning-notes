# Agent 的人工确认为什么必须由 Runtime 接管？

最近学习 Agent 时，我原本以为自己已经比较清楚 UI、LLM 和 Runtime 的职责：

- UI 负责交互和渲染；
- LLM 负责理解用户意图；
- Runtime 负责业务逻辑和工具执行。

这套分层本身没有错，但它还不够具体。

当 LLM 返回一个工具调用意图，而这个工具必须经过用户确认时，系统究竟应该在哪里暂停？谁保存“正在等待确认”这个事实？用户点击确认以后，又是谁决定工具可以真正执行？

直到我顺着一个可运行的 Node.js Demo，把消息发送、模型意图、人工确认、工具执行和前端渲染完整走了一遍，我才真正看到：

> 人工确认不是 UI 上的一个弹窗功能，而是 Runtime 状态机中的一个控制点。

完整 Demo：

[2026-07-28 Node Agent Chat Runtime](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-07-28-node-agent-chat-runtime)

## 我之前缺少的不是分层，而是完整生命周期

只说“UI 负责交互、LLM 负责意图、Runtime 负责逻辑”，很容易让人产生一种已经理解系统的感觉。

但只要加入人工确认，马上就会出现一组更具体的问题：

- LLM 返回工具意图后，工具会不会立刻执行？
- UI 弹出确认框以前，服务端保存了什么？
- 用户刷新页面后，确认框对应的是哪一次操作？
- 相同确认请求因为网络重试到达两次，工具会不会执行两次？
- 用户拒绝确认时，谁负责终止这次运行？
- 服务重启后，之前等待确认的操作还能不能恢复？

这些都不是 UI 或 LLM 能单独解决的问题。

我实际运行 Demo 后，得到的事件顺序是：

```text
UI → POST /api/messages
→ request.accepted
→ model.tool_call
→ confirmation.required
→ 用户 POST /confirm（approved=true）
→ confirmation.accepted
→ tool.started
→ tool.completed
→ response.output_text.delta
→ response.completed
```

这条事件链中有两次明显的控制权交接。

第一次发生在 `confirmation.required`：

```text
Runtime 暂停继续执行
→ UI 显示确认界面
→ 等待用户决定
```

第二次发生在用户提交确认以后：

```text
UI 发送 approved=true
→ Runtime 重新取得控制权
→ 校验状态
→ 执行工具
→ 返回结果
```

UI 只是把用户的决定传回服务端。真正决定工具能否执行的地方仍然是 Runtime。

## LLM 提出意图，不代表它获得了执行权限

在这个 Demo 中，模型返回的是一个 `write_note` 意图：

```js
{
  name: "write_note",
  arguments: {
    title: "学习记录",
    content: userMessage
  }
}
```

这个对象只表示：

> 模型认为下一步可以调用 `write_note`。

它不表示：

- 参数已经可信；
- 用户已经授权；
- 当前状态允许执行；
- 工具一定存在；
- 相同操作没有执行过；
- 这次调用符合业务权限。

这些判断都必须留在 Runtime。

因此，更准确的职责关系是：

| 组件 | 负责什么 |
| --- | --- |
| LLM | 理解语义并提出工具调用意图 |
| UI | 展示事件、收集用户确认、提交操作 |
| Runtime | 校验状态、参数、权限和确认策略，调度工具执行 |
| Tool | 真正产生外部副作用 |
| 用户 | 决定是否授权需要人工确认的操作 |

Runtime 内部还可以继续拆分：

- 工具策略判断；
- 参数结构校验；
- 身份和权限校验；
- 状态迁移；
- 工具执行；
- 幂等控制；
- 状态持久化；
- 事件发布。

所以，“逻辑在 Runtime”只是第一层理解。继续往下拆，才能看到每条安全边界究竟由谁实现。

## 为什么必须先保存状态，再通知 UI？

Demo 中最关键的顺序是：

```js
run.status = "waiting_confirmation";
run.pendingIntent = modelOutput;
run.idempotencyKey = `${run.id}:${modelOutput.name}`;

this.#emit(run, "confirmation.required", {
  tool: modelOutput.name,
  arguments: modelOutput.arguments
});
```

Runtime 先记录：

- 当前运行正在等待确认；
- 等待执行的工具意图是什么；
- 这次操作使用什么幂等标识。

然后才向 UI 发送 `confirmation.required`。

为什么不能反过来？

假设 Runtime 先发送事件：

```text
Runtime → confirmation.required → UI
```

UI 收到事件后立即弹出确认框，但服务端还没有保存相应状态。此时用户看到的是“系统正在等待确认”，Runtime 中却没有一个能够对应这次确认的运行记录。

接下来只要发生页面刷新、请求重试、进程故障或并发操作，UI 和 Runtime 就可能进入互相矛盾的状态：

```text
UI：正在等待用户确认
Runtime：没有等待确认的操作
```

用户点击确认后，Runtime 可能找不到对应的 run，也可能发现当前状态根本不允许确认。

因此，事件不应该成为事实本身。事件只是 Runtime 已保存状态的对外投影：

> 先让状态成立，再向外宣布状态已经成立。

不过这里必须保留一个边界：当前 Demo 只是把状态写进进程内的 `Map`。

它只能证明：

```text
同一个 Node.js 进程存活期间
先更新内存状态
再发布 UI 事件
```

它没有证明服务重启后可以恢复。真正支持跨重启恢复，还需要数据库或其他可靠存储，并继续解决：

- 状态与事件如何原子提交；
- 服务重启后如何恢复等待任务；
- 多实例如何避免并发执行；
- 旧确认请求如何判断是否仍然有效。

## 用户确认只是输入，执行决定仍在 Runtime

用户点击确认后，UI 发送：

```text
POST /confirm
approved=true
```

这不是让 UI 直接调用工具，而是把用户的决定传给 Runtime。

Runtime 仍然需要检查当前状态：

```js
if (run.status !== "waiting_confirmation") {
  throw new Error(`当前状态 ${run.status} 不能处理确认`);
}
```

只有当前运行确实处于等待确认状态，用户的批准才有效。

这点很重要，因为 `approved=true` 只表达用户态度，不证明当前操作仍然可以执行。

例如：

- 操作可能已经完成；
- 操作可能已经取消；
- 权限可能已经变化；
- 待执行意图可能已经过期；
- 相同确认请求可能已经处理过。

所以用户确认不是绕过 Runtime 校验的通行证。它只是 Runtime 判断执行条件时需要的一项输入。

## 重复确认为什么不能重复执行工具？

工具可能产生真实副作用：

- 新增数据库记录；
- 创建订单；
- 扣款；
- 发送邮件；
- 写入文件；
- 调用外部服务。

如果网络重试导致同一个确认请求到达两次，Runtime 不能简单地把工具再执行一遍。

Demo 先检查运行是否已经完成：

```js
if (run.status === "completed") {
  return this.getRun(runId);
}
```

工具执行前还会查询是否已经保存过相同幂等键对应的结果：

```js
let result = this.#toolResults.get(run.idempotencyKey);

if (!result) {
  result = this.#executeTool(run.pendingIntent);
  this.#toolResults.set(run.idempotencyKey, result);
}
```

第一次确认时：

```text
状态是 waiting_confirmation
→ 没有已保存结果
→ 执行工具
→ 保存结果
→ 状态变为 completed
```

相同确认再次到达时：

```text
状态已经是 completed
→ 直接返回已有结果
→ 不再执行工具
```

这也让我重新巩固了幂等与非幂等的区别。

幂等不是“第一次什么都不修改”，而是：

> 同一个操作重复执行多次，最终效果和执行一次相同。

例如：

```text
把状态设置为 active
```

重复设置通常仍然得到同一个最终状态，因此可以是幂等的。

而：

```text
余额增加 100
新增一条没有唯一键的记录
再次发送一封邮件
```

每执行一次都会产生新的副作用，默认属于非幂等操作。

`idempotencyKey` 这个具体字段名是 Demo 自己定义的，但“使用稳定业务标识避免重复副作用”是通用工程思想。

## 我还踩了一个术语上的坑

学习过程中，Demo 中出现了很多英文词：

- `waiting_confirmation`
- `pendingIntent`
- `confirmation.required`
- `idempotencyKey`

我一度以为它们是 DeepSeek 的默认协议，或者社区 Agent 框架统一使用的专业术语。

后来才确认：

- `waiting_confirmation` 是 Demo 自定义状态；
- `pendingIntent` 是 Demo 自定义字段；
- `confirmation.required` 是 Demo 自定义事件；
- `idempotencyKey` 的字段名和生成方式也是 Demo 自己决定的；
- 只有人工确认、状态持久化和幂等这些思想具有更广泛的工程意义。

这个问题提醒我：学习 Agent 时，不能看到一个英文名称就自动把它当成标准。

以后遇到新词，应该先问三件事：

1. 它是不是行业通用概念？
2. 它是不是某个框架或厂商定义的协议？
3. 它是不是当前示例为了讲解而自定义的名称？

如果不先标明来源，AI 很容易把一个简单设计包装成一组看起来很专业的词，反而增加理解成本。

真正应该保留的是结构和判断原则，而不是示例作者随手起的变量名。

## 这个 Demo 证明了什么，没有证明什么？

这次 Demo 的价值是把完整链路显式展示出来：

```text
用户发送消息
→ Runtime 调用模型 Stub
→ 模型返回工具意图
→ Runtime 进入等待确认状态
→ UI 显示确认框
→ 用户确认
→ Runtime 执行工具
→ SSE 返回执行结果
→ UI 完成渲染
```

我亲自运行页面并记录了事件顺序，因此可以确认：

- 人工确认的触发点位于 Runtime；
- 确认前工具没有执行；
- 用户确认后 Runtime 才执行工具；
- 重复确认不会让 Demo 中的工具重复执行；
- UI 展示的是 Runtime 发布的事件；
- 具体状态名和事件名不是社区统一规范。

但它没有证明：

- 真实 LLM 会稳定返回正确工具意图；
- 真实项目中的权限校验已经成立；
- 服务重启后可以恢复；
- 多个 Runtime 实例不会并发执行；
- 数据库写入和事件发布已经实现原子一致性；
- Demo 的状态机可以直接用于生产系统。

尤其需要注意：Demo 使用固定的 Fake Model，并且固定返回 `write_note`。它也把该工具固定设计成需要人工确认。

真实 Runtime 通常还需要根据工具类型、参数、用户权限和风险策略判断：

```text
requiresConfirmation = true 或 false
```

并不是所有工具调用都必须弹出人工确认。

## 我今天真正学会了什么？

我原本已经知道 UI、LLM 和 Runtime 应该分层，但今天第一次顺着代码和页面事件，把人工确认放进了完整生命周期。

现在我更明确地理解：

> LLM 负责提出意图，UI 负责交互，Runtime 负责让状态和权限真正成立，Tool 负责产生副作用，用户负责对需要人工控制的操作作出授权决定。

人工确认不是一个 UI 组件，而是 Runtime 状态机中的暂停点。

确认事件也不是状态真源。Runtime 应先保存等待确认所需的事实，再把事件发布给 UI。

用户点击确认后，Runtime 仍然需要校验状态和幂等结果，不能因为收到 `approved=true` 就无条件执行。

这次学习也让我再次意识到，阅读 AI 生成的 Demo 时必须区分四件事：

```text
我希望系统具备什么
AI 解释它实现了什么
代码实际上实现了什么
测试和实际运行证明了什么
```

当前 Demo 给了我一个清晰的最小链路，但真正的可靠持久化、权限控制和并发安全，仍然要放进真实项目继续验证。