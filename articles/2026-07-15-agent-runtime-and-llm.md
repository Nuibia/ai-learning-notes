# 我一直把 LLM 当成 Agent，直到我理解了 Runtime

我最近在系统学习 AI Agent，也一直在用 Codex、Claude 等工具完成真实项目。

我原本以为自己已经对 Agent 有了不少实践经验：会使用 Tool、MCP、Skill、Plugin，也做过多角色协作、状态回流、评估和人工确认。但在一次学习中，我被一个很基础的问题卡住了：

> 单个 Agent 的最小循环，第一步究竟是 LLM，还是 Runtime？

这个问题暴露了我认知中的一个空洞：我一直默认把 LLM 和 Agent Runtime 合成了一个东西。

理解 Runtime 之后，我才第一次真正看清一个 Agent 是怎样运行起来的。

## 我之前误解了什么？

以前，我脑中的 Agent 大致是这样的：

```text
用户提出目标
→ LLM 分析和决策
→ 调用工具
→ 完成任务
```

这个描述不能说完全错误，但它隐藏了最重要的问题：

- 用户的消息是谁交给 LLM 的？
- Prompt、历史消息和工具说明是谁组装的？
- LLM 返回工具调用后，谁真正执行工具？
- 谁检查路径、参数和权限？
- 工具执行结果又是谁交还给 LLM 的？
- 谁决定最多循环多少次，什么时候必须停止？

这些事情都不是 LLM 自己完成的。

它们通常由 Agent Runtime，也就是承载 Agent 运行的宿主程序或执行控制层完成。

## Runtime 到底是什么？

Runtime 不是另一个大模型，也不是什么神秘的 AI 组件。

它可以只是一段普通的 Node.js 或 Python 程序：接收用户请求、组装上下文、调用模型、校验模型提出的行动、执行工具、保存状态，然后决定是否继续下一轮。

如果把 LLM 比作 Agent 的“大脑”，那么 Runtime 更接近“身体、神经系统和控制系统”。

两者的职责可以简单划分为：

| 组件 | 主要职责 |
| --- | --- |
| LLM | 理解语义、推理、生成内容、提出行动意图 |
| Runtime | 组装上下文、调用 LLM、维护循环、校验行动、控制权限和预算 |
| Tool | 真正读取文件、调用 API、执行命令或修改数据 |
| 人 | 提供目标、确认高风险操作、验收结果 |

这里有一句非常重要的话：

> LLM 提议行动，Runtime 决定行动能否发生，并调用 Tool 让它真正发生。

严格来说，最终执行文件读取或 API 请求的是具体 Tool；Runtime 负责校验、调度、调用和回传结果。

## 一个 Agent 的最小运行循环

从完整系统的角度看，最小循环通常是：

```text
用户输入
  ↓
Runtime 接收请求并组装上下文
  ↓
Runtime 调用 LLM
  ↓
LLM 返回最终答案或 Tool Call
  ├─ 最终答案 → Runtime 返回给用户
  └─ Tool Call
        ↓
     Runtime 校验工具、参数、权限和预算
        ↓
     Tool 执行实际操作
        ↓
     Runtime 把结果加入上下文
        ↓
     再次调用 LLM
```

所以，“第一步是 Runtime”与“第一步是 LLM”其实是在回答两个不同的问题：

- 从程序如何开始运行看，Runtime 先接收请求并调用 LLM。
- 从谁先做出智能决策看，LLM 是第一个决策者。

## 用 TypeScript 看懂这个循环

下面是一个简化的 Agent Runtime。它不会连接真实模型，也不会真的读取文件，只用于展示结构。

```ts
import * as path from "node:path";

type ModelToolCallAction = {
  type: "tool_call";
  tool: string;
  args: { path: string };
};

type ReadFileAction = ModelToolCallAction & {
  tool: "read_file";
};

type FinalAction = {
  type: "final";
  content: string;
};

type Action = ModelToolCallAction | FinalAction;

type Message = {
  role: "user" | "assistant" | "tool";
  content: string;
};

async function callModel(messages: Message[]): Promise<Action> {
  // 真实项目中，这里会调用模型 API。
  // 模型可能返回最终答案，也可能提出 Tool Call。
  throw new Error("暂未接入模型");
}

function validateToolCall(
  action: Action,
): asserts action is ReadFileAction {
  if (action.type !== "tool_call") {
    throw new Error("当前 Action 不是工具调用");
  }

  if (action.tool !== "read_file") {
    throw new Error(`不允许调用工具：${action.tool}`);
  }

  const root = path.resolve("/knowledge");
  const normalizedPath = path.resolve(action.args.path);

  if (!normalizedPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("禁止读取知识库之外的文件");
  }

  if (path.extname(normalizedPath).toLowerCase() !== ".md") {
    throw new Error("只能读取 Markdown 文件");
  }
}

async function executeTool(
  action: ReadFileAction,
): Promise<string> {
  return `模拟读取结果：${action.args.path}`;
}

async function runAgent(goal: string): Promise<string> {
  const messages: Message[] = [
    { role: "user", content: goal },
  ];

  for (let round = 0; round < 3; round++) {
    const action = await callModel(messages);

    if (action.type === "final") {
      return action.content;
    }

    validateToolCall(action);

    let toolResult: string;

    try {
      toolResult = await executeTool(action);
    } catch (error) {
      toolResult =
        error instanceof Error
          ? `工具执行失败：${error.message}`
          : "工具执行失败：未知错误";
    }

    messages.push({
      role: "assistant",
      content: JSON.stringify(action),
    });

    messages.push({
      role: "tool",
      content: toolResult,
    });
  }

  throw new Error("超过最大执行轮数");
}
```

这段代码中：

- `callModel` 是 Runtime 调用 LLM 的位置；
- `validateToolCall` 是 Runtime 的行动校验；
- `executeTool` 才执行具体能力；
- `messages` 保存模型下一轮决策需要观察的结果；
- `for` 循环限制最大轮数，避免无限执行。

真实项目还必须处理一个问题：LLM 返回的是外部数据，TypeScript 类型不能证明运行时 JSON 一定合法。因此在进入业务逻辑前，还需要使用 JSON Schema、Zod 等进行运行时校验。

## Prompt 不是安全边界

理解 Runtime 后，我也重新认识了 Prompt、规则和评估之间的关系。

如果只在 Prompt 中写：

> 不要删除用户文件。

这只是软约束。模型可能遵守，也可能在复杂上下文、提示注入或误判中偏离。

如果 Runtime 根本不暴露删除工具，或者直接拦截删除命令，这才是硬约束。

如果任务结束后运行测试，确认原文件仍然存在，这是衡量证据。

| 类型 | 示例 | 作用 |
| --- | --- | --- |
| 软约束 | Prompt、规则、Skill 指令 | 告诉模型应该怎么做 |
| 硬约束 | Schema、权限、沙箱、白名单、状态机 | 限制系统实际能做什么 |
| 衡量证据 | 测试、Eval、日志、人工验收 | 判断系统实际上做得怎么样 |

我以前最苦恼的是“不知道怎样定义足够多的规则”。现在我意识到，问题不只是规则不够，而是把不同问题混在了一起：

- 规则回答“应该怎么做”；
- Runtime 边界回答“最多允许做什么”；
- Eval 回答“实际上做得怎么样”。

没有 Eval 时，继续增加 Prompt 规则，并不会自动让 Agent 更可控。

## MCP、Skill 和 Plugin 都不是 Runtime

我以前也容易把 MCP、Skill、Plugin 统称为“工具”。更准确的区分是：

- **Tool**：真正可执行的能力，例如读取文件、查询数据库。
- **MCP**：向宿主暴露 Tool、Resource 等能力的标准协议。
- **Skill**：完成某类任务所需的知识、步骤和约束，有时附带脚本。
- **Plugin**：打包和分发 Skill、MCP、应用等能力的容器。
- **Runtime**：把模型、上下文、工具、状态和控制边界组织成实际运行过程。

MCP 可以帮助 Runtime 发现和调用外部工具，但 Agent 并不只有通过 MCP 才能操作外部系统。本地函数、CLI 和 HTTP API 同样可以成为 Tool。

## AI 主导开发时，人应该负责什么？

我现在的开发方式通常是：我提供目标和思路，让 AI 完成具体编码。

这种方式没有问题，但理解 Runtime 后，我也发现了一个风险：阅读 AI 生成的代码时，我会把“设计上应该存在的能力”自动补进自己的理解。

例如，我以为 Runtime 已经检查了用户权限，但代码实际可能只检查了文件扩展名。

因此，即使不亲手敲每一行代码，人仍然要负责四件事：

1. 定义目标、风险和验收标准；
2. 找出代码真正实现了哪些约束；
3. 用反例预测系统行为；
4. 通过测试证明结果，而不是相信描述。

需要始终区分：

```text
我希望系统具备什么
AI 声称它实现了什么
代码实际上执行了什么
测试最终证明了什么
```

如果这四层没有分开，人就很容易在 AI 主导开发中产生“我已经理解并控制了系统”的错觉。

## 最后

今天这次学习没有让我记住更多框架名称，却补上了一个非常基础的结构认知：

> Agent 不等于 LLM。一个可行动的 Agent，至少需要模型、Runtime、Tool、上下文或状态，以及必要的控制边界。

LLM 提出答案或行动意图；Runtime 承载循环、校验行动并调用 Tool；Tool 完成实际操作；测试和人工验收提供最终证据。

理解这个结构之后，再看 Tool Calling、MCP、Skill、Guardrail、Human-in-the-loop 和 Eval，它们不再是一堆分散名词，而是可以放回同一个 Agent 系统中理解。

这也是我第一次真正感觉到：我不只是在使用 AI 工具，而是在开始理解它为什么能够行动，以及我们应该在哪里控制它。
