# Agent 卡在人工确认时，重启后怎么继续？我用检查点和 LangGraph 看懂状态恢复

前一篇学习中，我用报销助手理解了 Router、Workflow 和 Agent 的边界。

那时的流程里有一个看起来很自然的状态：金额超过阈值后，Runtime 返回 `waiting_confirmation`，等待用户确认，再继续创建报销记录。

```text
资料齐全
→ 金额超过阈值
→ waiting_confirmation
→ 用户确认
→ 创建报销记录
```

这个流程在一张图里没有问题，但只要把它放进真实系统，就会立刻遇到几个更难的问题：

- Runtime 在等待确认时重启了，怎么知道确认后要做什么？
- UI 已经弹出了确认框，但 Runtime 还没保存状态，此时进程崩溃怎么办？
- 工具调用超时了，究竟是没有执行，还是已经执行但响应丢了？
- 同一个人在两个页面分别点击“确认”和“取消”，哪一个操作有效？
- 换成 LangGraph 以后，这些问题是不是框架会自动解决？

我原本以为，给流程增加几个状态值就可以了。真正把 Demo 跑起来以后，我才意识到：可靠的 Agent 不是“记住当前状态”这么简单，而是要保存足够的运行事实，让 Runtime 在中断之后仍然知道下一步是什么、什么操作已经过期、哪些副作用不能盲目重试。

## 只保存 waiting_confirmation 为什么不够？

假设 Runtime 只持久化这一段数据：

```js
{
  status: "waiting_confirmation"
}
```

它只能说明：这个流程正在等待用户确认。

但用户点击确认以后，Runtime 还需要回答很多问题：

- 要执行哪个工具？
- 工具参数是什么？
- 这次操作是否需要幂等保护？
- 用户确认的是哪一次请求？
- 当前请求是否已经被另一个页面处理？

如果这些信息只存在于之前的内存或对话上下文里，Node 进程一旦重启，`waiting_confirmation` 就只剩下一块没有后续动作的标签。

因此，Demo 保存的是一个统一的运行状态：

```js
const runState = {
  runId: "run-demo-001",
  status: "waiting_confirmation",
  input: {
    text: "报销客户现场打车费 6000 元",
    amount: 6000
  },
  intent: {
    type: "submit_reimbursement",
    reimbursementType: "transport"
  },
  pendingAction: {
    type: "create_reimbursement_record",
    requiresConfirmation: true,
    idempotencyKey: "run-demo-001:create_reimbursement_record"
  },
  humanReview: null,
  result: null,
  error: null
};
```

这里最关键的不是字段名，而是两类事实必须同时存在：

- `status` 回答“现在处于哪个阶段”；
- `pendingAction` 回答“条件满足后准备执行什么”。

`waiting_confirmation`、`pendingAction` 都是当前 Demo 自己定义的名字，不是某个模型或社区框架规定的专业术语。真实项目完全可以换成其他名称，但不能丢掉它们表达的控制含义。

这也改变了我对 Agent 状态的理解：状态不是为了让 UI 显示一段文案，而是为了让 Runtime 在进程重启、请求重放和多页面并发时，仍然能够恢复业务控制。

## 为什么必须先保存状态，再通知 UI？

等待确认时，Runtime 需要完成两件事：

1. 保存“流程正在等待确认”以及确认后的动作；
2. 通知 UI 弹出确认框。

这两步的顺序不能交换。

正确顺序应该是：

```text
Runtime 生成待确认动作
→ 持久化 waiting_confirmation 与 pendingAction
→ 发送 confirmation.required
→ UI 弹出确认框
```

如果先向 UI 发送事件，再保存状态，可能出现下面的时间线：

```text
Runtime 发出 confirmation.required
→ UI 已经展示确认框
→ Runtime 在持久化前崩溃
→ 用户点击确认
→ Runtime 找不到对应的待执行动作
```

此时 UI 认为存在一项可以确认的操作，Runtime 却没有这项操作的可信记录，两边的状态已经分叉。

先持久化也不能让系统永远不失败，但它能把失败变成可恢复问题：即使 Runtime 在通知 UI 之前崩溃，重启后仍然可以读取检查点，再次发出确认事件。

Demo 中的 `saveCheckpoint` 会先写临时文件，再通过重命名替换正式检查点：

```js
export async function saveCheckpoint(state) {
  const validState = validateRunState(state);
  const temporaryPath = `${CHECKPOINT_PATH}.tmp`;

  await writeFile(
    temporaryPath,
    JSON.stringify(validState, null, 2)
  );
  await rename(temporaryPath, CHECKPOINT_PATH);
}
```

这个文件方案只是教学用的最小实现，但它让我真正看到了“检查点先于外部事件”的含义：不是先把界面做出来，再想办法补状态；而是 Runtime 先建立可以恢复的事实，再允许外部世界基于这个事实继续操作。

## failed 不代表工具没有执行

我以前看到工具调用进入 `failed`，很容易自然地理解成“工具执行失败了”。

但 `failed` 只说明 Runtime 没有拿到一次可以确认成功的结果，并不能证明外部副作用没有发生。

例如创建报销记录时，可能出现这样的顺序：

```text
Runtime 调用报销服务
→ 报销服务已经创建记录
→ 响应在返回途中超时
→ Runtime 只看到了 TOOL_RESPONSE_TIMEOUT
```

如果 Runtime 因为看到超时就生成一个新的请求，可能会创建第二条报销记录。

Demo 用一个 Map 模拟外部服务，并让第一次调用“服务端已写入，但响应丢失”：

```js
async function createReimbursementRecord(action, input) {
  const existingResult = externalReimbursementRecords.get(
    action.idempotencyKey
  );
  if (existingResult) return existingResult;

  const result = {
    recordId: `reimbursement-${externalReimbursementRecords.size + 1}`,
    amount: input.amount
  };
  externalReimbursementRecords.set(action.idempotencyKey, result);

  if (shouldLoseFirstResponse) {
    shouldLoseFirstResponse = false;
    throw new Error("服务端已创建记录，但响应在返回途中超时");
  }

  return result;
}
```

恢复时，Runtime 继续使用原来的 `idempotencyKey`。外部服务识别出这是同一个业务操作，返回第一次已经创建的结果，而不是新增记录。

最终运行结果中，服务端记录数仍然是 1。

这让我重新理解了失败恢复：

> Runtime 要恢复的是同一个业务动作，而不是重新发明一个看起来相同的新动作。

当然，幂等键也不是万能的。如果外部工具根本不支持幂等，也无法查询真实执行结果，Runtime 就不能假装自己知道副作用是否发生。资金、发布、删除等高风险操作进入这种不确定状态时，更安全的做法是保存人工处理点，让人结合审计记录和外部系统事实做决定。

人拥有最终决定权，但人也不是天然全知全能。可靠的人工介入仍然依赖 Runtime 保存足够的证据和允许操作。

## UI 发来的确认，只是一项请求

另一个容易被忽略的问题是：用户确认过，不代表这次确认现在仍然有效。

假设同一个人在两个页面打开同一笔报销：

```text
页面甲：点击确认
页面乙：稍后点击取消
```

页面甲先完成操作后，Runtime 的最新状态已经是 `completed`。页面乙看到的确认框来自旧状态，它提交的“取消”不能覆盖已经完成的事实。

Demo 在应用人工决定前，会重新检查最新状态：

```js
function applyHumanDecision(state, decision) {
  if (state.status !== "waiting_human_review") {
    throw new Error("当前状态不接受人工处理");
  }

  if (!state.humanReview.allowedActions.includes(decision)) {
    throw new Error(`不允许的人工操作：${decision}`);
  }

  // 根据最新状态执行允许的迁移
}
```

因此，UI 负责展示和收集用户操作，但 UI 不是运行状态的事实来源。用户点击按钮以后，Runtime 仍要根据最新持久化状态、版本和权限判断这项请求是否有效。

我现在会把这条边界说得更准确：

> 人拥有业务决定权，Runtime 拥有运行状态事实；UI 传来的确认或取消，只是对最新状态发起的一次迁移请求。

## 换成 LangGraph 后，哪些代码不用自己写了？

理解手写 Runtime 的控制含义后，我让 AI 用 LangGraph JS 重构了其中一段流程，再通过代码和运行结果核对框架实际承担的职责：

```text
校验授权
→ 执行工具
→ 完成运行
```

对应的 LangGraph 代码大致是：

```js
const graph = new StateGraph(RunState)
  .addNode("validate_approval", validateApproval)
  .addNode("execute_tool", executeTool)
  .addNode("complete_run", completeRun)
  .addEdge(START, "validate_approval")
  .addEdge("validate_approval", "execute_tool")
  .addEdge("execute_tool", "complete_run")
  .addEdge("complete_run", END)
  .compile({ checkpointer });
```

我原来使用过 Dify 和 Coze 的可视化工作流，所以第一次看这段代码时，把它映射成了：

| 可视化工作流里的概念 | LangGraph 中的概念 |
| --- | --- |
| 变量 | State |
| 节点 | Node |
| 连线 | Edge |
| 一次运行的标识 | thread_id |
| 状态快照的保存与读取 | Checkpointer |

这里我最初把 `thread_id` 直接理解成“运行记录与恢复”，后来发现并不准确。

`thread_id` 只是定位某条线程的标识。真正保存和读取图状态的是 Checkpointer。LangGraph 官方文档也把 Checkpointer 定义为保存线程图状态快照的持久化机制。

Demo 使用的是 `MemorySaver`：

```js
const checkpointer = new MemorySaver();

const config = {
  configurable: {
    thread_id: "run-demo-001"
  }
};
```

它可以让我在同一个进程里观察 `getState()` 和 `getStateHistory()`，但它把检查点放在内存中。Node 进程一旦重启，所有记录都会丢失。生产环境要跨重启恢复，需要换成持久化 Checkpointer，例如数据库或文件实现。

因此，框架提供“检查点接口”不等于应用已经具备“生产级持久化”。必须继续追问：当前使用的具体存储是什么，它能跨进程、跨实例和跨部署保留多久？

## LangChain 和 LangGraph 的关系，也和我记忆中不同了

我以前的理解是：LangChain 更基础，LangGraph 是后来出现的二次封装，帮助开发者更方便地编写 Agent。

这个历史印象有来源，但已经不能准确描述当前版本。

按照当前官方定位：

- LangGraph 是面向长时间运行、有状态 Agent 的低层编排框架和 Runtime；
- LangChain v1 提供更高层的 Agent 抽象；
- LangChain v1 的标准 Agent API `createAgent` 构建在 LangGraph 之上；
- LangGraph 可以独立使用，并不强制依赖 LangChain。

官方文档把两者概括为：LangChain 是 Agent Framework，LangGraph 是 Orchestration Runtime。

这里最容易说过头的一句话是“LangChain 的基础能力都运行在 LangGraph 上”。更准确的范围是：LangChain v1 的高层 Agent API，尤其 `createAgent`，使用 LangGraph 提供持久化、流式、人工介入等运行能力；不能把这个结论扩大到整个 LangChain 生态中的所有包和功能。

资料来源：

- [LangChain v1 更新说明](https://docs.langchain.com/oss/javascript/releases/langchain-v1)
- [LangGraph 官方概览](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [LangGraph 持久化说明](https://docs.langchain.com/oss/javascript/langgraph/persistence)

## 框架不会替 Runtime 决定业务语义

LangGraph 可以组织节点和边、保存检查点、恢复线程，也能支持人工介入。但它不会替我的报销助手决定：

- 多少钱需要审批；
- 哪些角色可以批准；
- 超时后是否允许自动重试；
- 哪些操作必须使用幂等键；
- 旧页面的请求何时失效；
- 人工介入时允许“重试”“取消”还是“修改后继续”。

这些规则仍然属于应用 Runtime。

框架负责提供运行基础设施，应用负责定义业务语义。即使两个项目都使用 LangGraph，它们也可能拥有完全不同的状态结构、权限边界和恢复策略。

这也是为什么我最终没有因为学习了 LangGraph，就决定把现有 Mastra 项目迁移过去。

我的项目已经在使用 Mastra，现有能力和团队熟悉度能够覆盖当前需求。为了使用一个新框架而迁移，会增加改造、回归和维护成本，却没有带来明确收益。当前真正需要的只是把金额判断、人工复核和状态约束继续放进 Runtime。

框架选型不应该服务于新鲜感，而应该服务于具体约束：

- 当前框架是否缺少关键能力？
- 恢复、可观测性和人工介入要求有多复杂？
- 团队是否能够维护新的抽象？
- 迁移成本是否小于长期收益？

如果未来出现复杂的可恢复状态图、长时间任务和更强的检查点控制需求，我会重新评估 LangGraph；但不是因为它“更底层”或“更新”，就自动认为它更适合当前项目。

## 这次 Demo 最终证明了什么？

这组 Demo 由 AI 辅助生成代码，我负责补全业务场景、检查控制边界，并用反例和运行结果验收。这里的实践重点不是把 AI 写的代码算成我亲手实现，而是判断它是否忠实表达了状态恢复、幂等和并发规则。

手写 Runtime Demo 覆盖了下面几条路径：

```text
先保存检查点，再通知 UI
→ Runtime 重启后恢复 waiting_confirmation 与 pendingAction

外部服务已执行，但响应超时
→ Runtime 保存失败与人工处理点
→ 使用同一个 idempotencyKey 恢复
→ 外部记录数仍然是 1

页面甲已经完成
→ 页面乙提交过时取消请求
→ Runtime 根据最新状态拒绝
```

LangGraph Demo 则展示了：

```text
StateGraph 按节点和边执行
→ Checkpointer 保存线程状态快照
→ getStateHistory() 可以读取检查点历史
→ MemorySaver 在进程重启后仍会丢失
```

完整代码与运行方式见：[2026-08-03 状态机、检查点与 LangGraph Demo](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-03-agent-state-checkpoint)。

运行命令：

```bash
cd examples/2026-08-03-agent-state-checkpoint
node demo.mjs
npm start
```

## 最后

这次学习让我把“人工确认”从一个 UI 按钮，重新理解成了一段需要持久化、校验和恢复的 Runtime 流程。

我现在相信：

1. `status` 只说明当前阶段，可靠恢复还要保存下一步动作、幂等键和必要证据；
2. Runtime 必须先建立可信检查点，再向 UI 暴露可以操作的事件；
3. 工具超时不代表副作用未发生，恢复的是同一个业务动作，而不是重新创建一个动作；
4. 人拥有最终决定权，但 Runtime 仍然是运行状态的事实来源；
5. LangGraph 能提供图编排、检查点和恢复能力，但不会替应用决定业务规则；
6. 学会一个框架，不等于现有项目就应该迁移到这个框架。

以前我更关注 Agent 能不能正确调用工具。现在我开始继续追问：调用前后到底保存了什么事实，进程重启后还能不能恢复，外部副作用不确定时谁有权继续，以及框架承诺的能力是否真的被当前存储实现兑现。

对一个会行动的 Agent 来说，这些问题可能比“模型这次回答得够不够聪明”更接近可靠性的核心。