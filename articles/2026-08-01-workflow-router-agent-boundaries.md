# 意图识别之后，Agent 到底该怎么做？我用报销流程理解 Router、Workflow 与 Agent

> 完整 Demo：[Workflow、Router 与 Agent 的选择](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-01-workflow-router-agent)

前一阶段，我一直在学习 RAG：文档怎样切片、检索结果怎样召回，以及检索成功后为什么仍可能生成错误答案。

今天跳出 RAG，重新回到 Agent。我最初有一点意外，因为课程中的“意图识别”很快就被压缩成了一句话：

> LLM 根据用户的自然语言，识别出一个结构化意图。

这件事本身已经在我的认知范围内。真正让我开始深入思考的，是意图识别之后的问题：

> Runtime 拿到意图以后，到底应该做什么？什么时候只需要 Router，什么时候应该写 Workflow，又什么时候才真的需要 Agent？

我当然知道 Agent 不只是答疑，也知道它可以调用工具完成实际操作。只是前几天一直在学习 RAG，注意力都放在“怎样检索并增强回答”上，今天突然切换到报销流程这种行动场景，我一开始有些不适应。

把报销 SOP 写成一个可运行 Demo 后，我对“Agent 怎样行动”有了更具体的理解：模型识别出意图以后，还需要 Runtime 把它接入确定的业务分支、流程和工具；不能只靠 LLM 自由发挥。

## 先说明：Router 不是本文创造的标准，但也不是统一规范

`Routing`（路由）不是本文临时造出来的概念。Anthropic 在《Building effective agents》中把 **Workflow: Routing** 列为常见模式：先对输入分类，再把它送到专门的后续任务；它还明确区分了预先编排代码路径的 Workflow 与由模型动态决定过程的 Agent。

OpenAI Agents SDK 也区分“由代码编排”和“由 LLM 编排”，并在多 Agent 场景使用 Handoff 等机制完成分流。不过，不同框架的名称和接口并不统一。

因此，本文使用 `Router` 作为“负责选择确定分支的那段路由逻辑”的简称，而不是声称社区存在一个统一的 `Router` 类、JSON Schema 或协议。

参考：

- [Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [OpenAI Agents SDK：Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
- [OpenAI Agents SDK：The agent loop](https://openai.github.io/openai-agents-python/running_agents/#the-agent-loop)

## 意图识别只是入口，不是完整业务

假设用户输入：

```text
我要申请一笔 6000 元的出差住宿费报销。
```

LLM 很适合把这句话识别成类似下面的结果：

```js
{
  kind: "travel",
  amount: 6000
}
```

但到这里，报销并没有真正发生。

系统仍然需要回答一系列确定性问题：

- `travel` 是否属于系统允许的报销类型？
- 出差报销需要哪些材料？
- 用户是否提交了发票？
- 金额超过 5000 元时是否需要人工确认？
- 当前是否允许创建报销记录？
- 相同请求怎样避免重复写入？

这些问题不能因为 LLM 已经返回一个看起来合理的 JSON，就默认全部成立。

我现在对这条链路的理解是：

```text
用户自然语言
→ LLM 识别意图
→ Runtime 校验结构和允许值
→ Router 选择业务分支
→ Workflow 按固定顺序执行
→ 在满足条件时调用 Tool
```

LLM 负责理解“用户想做什么”，Runtime 负责判断“这个意图是否有效、应该进入哪条流程、当前能不能真的执行”。

## 本文所说的 Router：决定进入哪条分支

本文所说的 Router 解决的是“去哪里”的问题。它是通用路由思想在当前 Demo 中的实现，不是引用某个框架的固定 API。

如果输入已经是固定枚举，Runtime 可以直接通过确定性代码选择处理器：

```js
const handlers = {
  faq: "faqHandler",
  refund: "refundHandler",
  account: "accountHandler",
};

function routeByKind({ kind, question }) {
  const handler = handlers[kind];

  if (!handler) {
    throw new Error("UNKNOWN_KIND");
  }

  return {
    route: kind,
    handler,
    question,
    decisionOwner: "runtime_code",
  };
}
```

这里没有必要让 LLM 再决定一次。`kind` 已经是结构化字段，Runtime 按映射表选择处理器，更稳定，也更容易测试。

只有输入仍然是自然语言时，才需要语义分类器：

```js
async function routeByText({ question, classifyIntent }) {
  const kind = await classifyIntent(question);
  return routeByKind({ kind, question });
}
```

`classifyIntent` 可以由 LLM 实现，但模型返回的 `kind` 仍要进入 `routeByKind` 校验。LLM 可以提出分类，不能自己给未知分类增加系统权限。

因此，Router 的关键不在于有没有调用模型，而在于：

> 分支集合是预先确定的，最终选择和合法性由 Runtime 控制。

## Workflow：把固定 SOP 写成代码

Workflow 解决的是“按什么顺序做”的问题。

报销助手本来就有 SOP：识别报销类型、读取对应政策、检查资料、判断是否需要确认，最后才能创建记录。这些步骤和顺序都可以提前确定。

我用自然语言描述了下面这条流程，再让 AI 把它转成代码：

```text
Runtime 收到 text 和 amount
→ classifyIntent(text) 识别报销类型
→ Runtime 校验报销类型
→ 根据类型读取政策
→ 校验资料是否完整
→ 金额超过 5000 元时等待确认
→ 条件满足后创建报销记录
```

对应的核心代码是：

```js
async function runReimbursementWorkflow({
  text,
  amount,
  classifyIntent,
  loadPolicy,
  validateFields,
  createRecord,
}) {
  const trace = ["1.classify"];
  const kind = await classifyIntent(text);

  if (!reimbursementKinds.has(kind)) {
    throw new Error("UNKNOWN_REIMBURSEMENT_KIND");
  }

  trace.push("2.load_policy");
  const policy = await loadPolicy(kind);

  trace.push("3.validate_fields");
  const missing = await validateFields({ text, amount, kind, policy });

  if (missing.length > 0) {
    return { status: "missing_fields", kind, missing, trace };
  }

  if (amount > 5000) {
    return { status: "waiting_confirmation", kind, amount, trace };
  }

  trace.push("4.create_record");
  const record = await createRecord({ text, amount, kind, policy });

  return { status: "completed", kind, record, trace };
}
```

这段代码里，LLM 可以参与第一步分类，但它不能改变后面的执行顺序，也不能绕过资料校验和金额确认直接调用 `createRecord`。

这让我确认了一条很实用的判断标准：

> 流程里使用了 LLM，不代表整个流程就是 Agent Loop。只要步骤和分支由代码预先规定，它仍然是 Workflow。

## waiting_confirmation 不是结束，而是检查点

我在描述流程时曾把“金额高于 5000 元”说成“本次流程终止”。这个说法需要更准确一点。

从当前请求来看，Runtime 确实会返回，不再继续创建记录；但从完整业务生命周期看，`waiting_confirmation` 不是永久结束，而是一个暂停点：

```text
资料齐全
→ 金额超过 5000 元
→ Runtime 保存 waiting_confirmation
→ 通知 UI 展示确认操作
→ 用户或审批人授权
→ Runtime 从检查点恢复
→ 再次校验状态和权限
→ 创建报销记录
```

当前 Demo 只做到“进入等待状态并阻止写入”，还没有实现持久化恢复。这正好为下一章“状态机、检查点与人工介入”留下了实践入口。

## 为什么这个场景不需要 Agent Loop？

Agent Loop 解决的是另一类问题：下一步不能完全提前确定，需要模型根据目标和最新观察继续选择工具。

例如调查“订单为什么还没退款到账”时，模型可能先查询订单，再根据订单状态决定是否查询退款政策，最后判断是否还要调用其他工具。工具顺序和结束时机不一定能在运行前完全写死。

一个最小 Agent Loop 可能是：

```js
for (let step = 0; step < maxSteps; step += 1) {
  const action = await decideNext({ goal, observations });

  if (action.type === "final") {
    return action.content;
  }

  if (action.type !== "tool_call" || !tools[action.tool]) {
    throw new Error("TOOL_NOT_ALLOWED");
  }

  const result = await tools[action.tool](action.args ?? {});
  observations.push({ action, result });
}
```

这里模型拥有的是“提出下一步”的控制权；Runtime 仍然负责工具白名单、参数校验、最大步数和真正执行。

而报销助手的类型、资料要求、金额阈值和创建顺序都已经明确。为了让它看起来更像 Agent 而加入循环，只会增加不可预测性、调用成本和测试难度。

我现在会先问：

1. 分支能否预先列举？能，就先考虑 Router。
2. 步骤和结束条件能否预先确定？能，就先考虑 Workflow。
3. 是否必须根据运行中的观察动态选择下一工具？确实需要，才考虑 Agent Loop。

## Demo 中的状态名都是本地定义

为了让运行结果容易观察，Demo 定义了下面这些名称：

- `kind`、`classifyIntent`、`runReimbursementWorkflow`；
- `missing_fields`、`waiting_confirmation`、`completed`；
- `UNKNOWN_REIMBURSEMENT_KIND`、`createRecordCalls`、`trace`。

这些都是当前教学代码的本地字段、状态值、错误码或变量名，不是 DeepSeek、OpenAI、Anthropic 或某个社区 Agent 框架规定的关键词。真实项目完全可以改成别的名字；重要的是它们背后的控制含义，而不是记住这些字符串。

同样，本文把金额超过 5000 元后的本地状态命名为 `waiting_confirmation`，只是为了表示“当前调用暂停，尚未允许写入”。框架可能把相同含义表达为 approval、interrupt、checkpoint、pending action 或其他结构。

## 四条运行结果证明了什么？

只看代码描述还不够，我实际运行了四条报销路径。

第一条，分类器返回系统不支持的类型：

```text
非法类型 → UNKNOWN_REIMBURSEMENT_KIND
```

第二条，类型合法但缺少发票：

```text
缺少资料 → missing_fields
```

第三条，资料齐全但金额为 6000 元：

```text
超过阈值 → waiting_confirmation
```

第四条，资料齐全且金额为 5000 元：

```text
满足条件 → completed
```

最终输出还有一条：

```text
createRecordCalls: 1
```

这条结果比“代码看起来会拦截”更有价值。它证明四个测试场景中，只有满足全部条件的分支真正调用了一次 `createRecord`；其他分支都停在 Runtime 对应的控制点。

完整代码和运行方式见：[2026-08-01 Workflow、Router 与 Agent Demo](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-01-workflow-router-agent)。

## 自然语言转代码以后，人负责什么？

这次实践也符合我越来越确定的一种开发方式：我先用自然语言描述业务流程，由 AI 转成代码，我再判断代码是否忠实表达了流程。

在这种模式下，“会不会亲手写出每一行”不再是唯一能力。更重要的是：

- 能否把模糊需求说成明确输入、分支、状态和副作用；
- 能否发现 AI 遗漏的字段含义和隐式条件；
- 能否判断控制权究竟在 LLM 还是 Runtime；
- 能否用反例验证不该发生的写入确实没有发生；
- 能否区分代码已经证明的事实和自己脑中自动补全的能力。

今天的练习一开始只给出了字段名，却没有解释字段含义和期望产出。我无法凭这些信息完成设计。后来补齐“输入是什么、允许哪些类型、资料缺失时怎样返回、什么时候确认、什么时候允许写入”以后，我才能用自然语言写出完整流程。

这不是措辞问题，而是自然语言开发的基本前提：

> 如果需求本身没有讲清输入、输出、约束和边界，AI 生成的代码再完整，也可能只是在完整地实现一个错误猜测。

## 我今天真正改变的认识

今天并没有让我推翻以前对 LLM、UI 和 Runtime 的理解。变化在于，这些概念终于从“分层原则”落到了一个可以执行的业务流程里。

以前我说：

```text
LLM 负责意图识别，Runtime 负责逻辑，UI 负责交互。
```

今天我能继续往下追问：

- LLM 返回什么结构？
- Runtime 怎样校验它？
- Router 把它送进哪条分支？
- Workflow 规定哪些固定步骤？
- 哪个状态会阻止工具调用？
- 什么证据能证明副作用只发生了一次？

今天的学习重点也从 RAG 的检索与回答，切换到了怎样把现实中的固定 SOP 接进系统，并通过工具完成更具体、更复杂的行为。

但越接近真实行为，越需要明确控制权：

> LLM 擅长理解和提议；Runtime 负责约束和执行。固定问题使用 Router，固定过程使用 Workflow，真正无法提前确定的下一步才交给 Agent 动态决策。

这也是我从这次报销 Demo 中得到的最重要结论。