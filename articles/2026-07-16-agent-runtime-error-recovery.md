# Agent Runtime 出错后，应该由谁恢复？

> 掘金发布地址：[https://juejin.cn/spost/7662777075909607475](https://juejin.cn/spost/7662777075909607475)

昨天我写了一篇文章：[《我一直把 LLM 当成 Agent，直到我理解了 Runtime》](https://juejin.cn/post/7662376768221331465)。

那次学习让我第一次分清：LLM 只是 Agent 的“大脑”，它可以分析、生成内容和提出 Tool Call，但真正组装上下文、校验行动、执行工具和维护循环的是 Runtime。

理解这层结构后，我今天继续追问了一个更具体的问题：

> LLM 提出的 Tool Call 如果执行失败，接下来究竟应该由谁处理？

我原本以为答案很简单：失败了就重试，重试不成功就报错。

后来才发现，这里面至少有三个不同问题：

1. 相同操作再执行一次，是否可能成功？
2. LLM 能否换一个合法方案继续完成目标？
3. 是否必须让用户修改路径、补充授权或重新确认？

也就是说，Agent 的错误处理并不只是“重试或结束”，而是在决定：这次失败应该由 Runtime、LLM、用户中的谁来恢复。

## 先从正常路径说起

假设用户要求 Agent 总结一个 Markdown 文件，完整路径大致是：

```text
用户提出目标
→ Runtime 组装 messages
→ Runtime 调用 LLM
→ LLM 提出 read_file Tool Call
→ Runtime 校验工具、路径和文件类型
→ Runtime 调用 read_file
→ Tool 返回文件内容
→ Runtime 把 Tool 结果写入 messages
→ Runtime 再次调用 LLM
→ LLM 根据文件内容生成总结
→ Runtime 把 final 返回给用户
```

这里有一个我以前容易忽略的细节：Tool 成功读取文件后，Runtime 通常不会把文件内容直接当成最终答案返回给用户。

因为 Tool 只完成了“读取文件”，用户的目标却是“总结文件”。Runtime 需要把结果以 `role: "tool"` 放回上下文，再让 LLM 完成语义层面的任务。

```ts
messages.push({
  role: "tool",
  content: toolResult,
});
```

因此，只要还需要 LLM 继续分析，Runtime 就没有结束。

## 为了讨论错误处理，先写一个最小 Runtime

为了让文章能够独立阅读，这里直接放出后文依赖的最小版本。

它只做一件事：让 LLM 决定是调用 `read_file`，还是返回 `final`。Runtime 只允许读取 `/knowledge` 中的 Markdown 文件，并约定 `readFile` 将网络超时等暂时性故障包装为 `TransientToolError`。这类错误最多重试两次。

为了聚焦错误控制流，下面假设模型已经返回符合 `Action` 类型的结果。真实项目还需要对模型返回的 JSON 做运行时 Schema 校验。

```ts
import * as path from "node:path";

type Message = {
  role: "user" | "assistant" | "tool";
  content: string;
};

type Action =
  | {
      type: "tool_call";
      tool: string;
      args: { path: string };
    }
  | {
      type: "final";
      content: string;
    };

type Model = {
  decide(messages: Message[]): Promise<Action>;
};

type Tools = {
  readFile(filePath: string): Promise<string>;
};

class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

class TransientToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientToolError";
  }
}

function validateReadFileCall(
  action: Extract<Action, { type: "tool_call" }>,
  rootDirectory: string,
): string {
  if (action.tool !== "read_file") {
    throw new RuntimeError(
      "TOOL_NOT_ALLOWED",
      `不允许调用工具：${action.tool}`,
    );
  }

  const root = path.resolve(rootDirectory);
  const target = path.resolve(action.args.path);

  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new RuntimeError(
      "PATH_OUTSIDE_ROOT",
      "禁止读取知识库目录之外的文件",
    );
  }

  if (path.extname(target).toLowerCase() !== ".md") {
    throw new RuntimeError(
      "FILE_TYPE_NOT_ALLOWED",
      "只能读取 Markdown 文件",
    );
  }

  return target;
}

async function executeWithRetry(
  operation: () => Promise<string>,
  maxRetries: number,
): Promise<string> {
  let retries = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const canRetry =
        error instanceof TransientToolError &&
        retries < maxRetries;

      if (!canRetry) {
        throw error;
      }

      retries += 1;
    }
  }
}

async function runAgent(
  goal: string,
  model: Model,
  tools: Tools,
): Promise<string> {
  const messages: Message[] = [
    { role: "user", content: goal },
  ];

  for (let round = 0; round < 3; round += 1) {
    const action = await model.decide(messages);

    if (action.type === "final") {
      return action.content;
    }

    const safePath = validateReadFileCall(
      action,
      "/knowledge",
    );

    const toolResult = await executeWithRetry(
      () => tools.readFile(safePath),
      2,
    );

    messages.push({
      role: "assistant",
      content: JSON.stringify(action),
    });

    messages.push({
      role: "tool",
      content: toolResult,
    });
  }

  throw new RuntimeError(
    "MAX_ROUNDS_EXCEEDED",
    "连续三轮仍未得到最终答案",
  );
}
```

这不是完整的生产级 Agent，但足够支撑本文的问题：Tool 成功、调用前被拒绝、执行中暂时失败和重试耗尽时，Runtime 分别会发生什么。

## Runtime 首先要区分：调用前失败，还是执行中失败

上面的简化 Runtime 只允许调用 `read_file`，只允许读取指定知识库目录中的 Markdown 文件。

调用 Tool 之前，它会检查：

- LLM 选择的是否为 `read_file`；
- 目标路径是否位于允许的目录内；
- 文件后缀是否为 `.md`。

例如 LLM 请求调用 `delete_file`，Runtime 会在校验阶段直接抛出 `TOOL_NOT_ALLOWED`。此时 `delete_file` 根本没有被执行。

```ts
if (action.tool !== "read_file") {
  throw new RuntimeError(
    "TOOL_NOT_ALLOWED",
    `不允许调用工具：${action.tool}`,
  );
}
```

这属于调用前失败。它反映的是 Runtime 的硬边界，而不是 Tool 的临时故障。

另一类错误发生在 Tool 已经获得执行许可之后。例如路径和文件类型都合法，但读取服务发生了网络超时。这才属于执行中失败。

两者不能使用相同的处理方式：

- 调用前校验失败，不应该真的执行 Tool；
- 执行中暂时失败，可能适合在有限预算内重试。

## 不是所有 Error 都应该重试

当前示例通过 `TransientToolError` 表示暂时性工具故障：

```ts
export class TransientToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientToolError";
  }
}
```

Runtime 的重试判断是：

```ts
const canRetry =
  error instanceof TransientToolError &&
  retries < maxRetries;
```

我一开始看错了继承方向。我以为 `TransientToolError` 继承了 `Error`，所以普通 `Error` 也会被这段判断拦截并重试。

实际正好相反：

```ts
new TransientToolError("超时") instanceof Error;
// true

new Error("文件不存在") instanceof TransientToolError;
// false
```

子类的实例也是父类的实例，但父类的实例不一定是这个子类。

因此，只有明确被识别为 `TransientToolError` 的错误，以及它未来可能存在的子类，才会进入当前重试逻辑。普通 `Error("文件不存在")` 会直接抛出。

这里的错误类型并不只是为了展示不同的错误名称，它实际上参与了 Runtime 的控制流决策。

## 可重试，不等于可恢复

这是我今天最重要的收获。

### 网络超时：通常可重试

如果 Tool 因为偶发超时失败，相同调用稍后执行可能成功。Runtime 可以在限定次数内自行重试，不必每次都把错误交给 LLM。

如果 `maxToolRetries = 2`，它表示首次执行失败后最多再重试两次，也就是最多尝试三次，而不是总共执行两次。

### 文件不存在：通常不可原样重试，但可能恢复

如果路径对应的文件不存在，相同路径立即读取十次通常仍然不存在，所以不应该盲目重试。

但任务不一定必须结束。Runtime 可以把安全的结构化错误交回 LLM，LLM 再向用户确认是不是写错了路径。

```text
read_file 返回 FILE_NOT_FOUND
→ Runtime 不原样重试
→ Runtime 把错误写入 messages
→ LLM 请求用户修正路径
```

因此，它是“不可重试，但可以在用户参与后恢复”。

### 权限不足：不能用重试突破边界

如果 Runtime 只允许读取 `/knowledge`，LLM 却请求 `/secret/password.md`，重复执行不会让权限突然变得合法。

Runtime 应在 Tool 执行前拒绝。它可以把一个不泄露额外信息的错误交给 LLM，让 LLM 告诉用户当前路径不被允许，但绝不能因为 LLM 再次提出请求就绕过限制。

这里我还想到了一种看似友好、实际上很危险的设计：目标文件不能读取时，Runtime 自动搜索 `/knowledge` 中的相似文件，再把内容交给 LLM。

问题是，用户可能只授权 Agent 读取一个明确文件，并没有允许它扫描其他资料。为了“更好的体验”而静默扩大读取范围，本质上仍然越过了用户授权。

如果确实需要搜索，应当满足两个条件：

1. 用户目标或后续确认允许扩大搜索范围；
2. Runtime 通过显式的 `search_files` 或 `list_files` Tool 执行，并继续进行权限校验。

### 工具不支持：先拦截，再考虑合法替代方案

如果 LLM 请求 `delete_file`，但当前 Agent 只提供 `read_file`，Runtime 应在校验阶段拒绝，而不是调用一个不存在或未授权的 Tool。

错误能否交回 LLM，要看是否还有合法方案：

- 有其他已授权 Tool 能完成目标，可以让 LLM重新决策；
- 没有合法替代能力，就应该说明限制或结束任务；
- 无论如何，LLM 都不能决定突破 Runtime 的工具白名单。

## “停止重试”和“结束 Runtime”不是一回事

我在回答网络超时的处理方式时说过一句话：

> Runtime 结束，并把错误按照特定结构告诉 LLM。

这句话其实自相矛盾。

把错误交给 LLM，本身就是 Runtime 在做的事情。LLM 不会主动从 Tool 那里获取错误，它只能接收 Runtime 组装好的输入。

如果 Runtime 整体已经结束，就不可能再次调用 LLM。

准确的流程应该是：

```text
重试预算耗尽
→ 结束本次 Tool 重试阶段
→ Runtime 生成结构化错误
→ Runtime 把错误写入 messages
→ Runtime 再次调用 LLM
→ LLM 解释失败、提出合法替代方案或输出 final
→ Runtime 返回最终结果
```

只有出现下面这些情况时，才能说整个 Agent 真正结束：

- LLM 返回 `final`，Runtime 将它返回给用户；
- Runtime 判定错误无法安全恢复，直接终止；
- 达到最大 Agent 循环次数；
- 用户主动取消或拒绝继续。

所以，Tool 执行阶段、Tool 重试阶段和整个 Agent 生命周期是三层不同的范围。

## 我会怎样设计结构化错误？

当前示例代码主要用于理解最小结构：校验错误和普通 Tool 错误会直接抛出，只有暂时性错误会重试，成功结果才会返回给 LLM。

如果继续完善，我倾向于让 Runtime 把错误标准化为类似这样的结构：

```ts
type RecoveryActor =
  | "runtime"
  | "llm"
  | "user"
  | "none";

type ToolFailure = {
  code: string;
  safeMessage: string;
  retryable: boolean;
  recoveryActor: RecoveryActor;
  attempts: number;
};
```

例如：

| 错误 | 是否原样重试 | 主要恢复者 | Runtime 的动作 |
| --- | --- | --- | --- |
| 临时网络超时 | 是，有限次数 | Runtime | 在预算内重试 |
| 文件不存在 | 否 | LLM / 用户 | 返回安全错误，请求修正路径 |
| 权限不足 | 否 | 用户 | 拒绝执行，请求合法路径或授权 |
| 工具不支持 | 否 | LLM / 无 | 选择合法 Tool，或说明无法完成 |
| 重试耗尽 | 否 | LLM / 用户 / 无 | 停止重试，决定继续循环还是终止 |

这张表并不是所有 Agent 都必须照搬的答案。不同业务对安全、成本和用户体验的要求不同。但它至少迫使设计者明确四件事：

- 这个错误是否可能自行消失；
- 相同调用是否值得再次执行；
- LLM 是否拥有合法替代方案；
- 是否必须让用户重新决策或授权。

## 人在这套错误处理中负责什么？

LLM 可以帮助解释错误，Runtime 可以执行策略，但用户仍然是授权边界和目标变更的最终决定者。

例如：

- 文件路径写错，可以让用户更正；
- 需要扩大搜索目录，应该让用户确认；
- 需要执行危险 Tool，必须遵守系统权限和人工控制点；
- 即使 Agent 声称已经恢复，也仍需要结果或测试证明任务真的完成。

对我这种“人提供思路，AI 完成具体代码”的开发方式来说，这一点尤其重要。我不能只听 AI 说“错误已经处理”，而要继续追问：

```text
哪一类错误会重试？
重试多少次？
谁把错误交回 LLM？
LLM 能否更换方案？
更换方案是否仍在用户授权范围内？
什么时候整个 Agent 必须停止？
```

这些问题最终都应该在 Runtime 代码、错误类型、状态机和测试中找到证据。

## 最后

昨天我学会了：Agent 不等于 LLM，Runtime 才是承载循环和实际控制边界的部分。

今天我进一步理解了：Runtime 不只是负责“调用 Tool”，它还要为失败分类，并决定后续控制流。

最值得记住的不是某个错误类的名字，而是这句话：

> 可重试性不等于可恢复性。一次 Tool 调用失败后，Runtime 必须决定由自己重试、交给 LLM换方案、请求用户介入，还是结束整个 Agent。

LLM 可以提出行动，也可以根据错误调整方案；但错误是否进入 LLM、什么数据可以进入、行动能否再次发生，最终仍由 Runtime 控制。

当我能把失败分成“调用前校验、执行中重试、执行后恢复”三层以后，Agent 的异常处理终于不再只是一个模糊的 `try...catch`，而开始变成一套可以被设计、约束和验证的运行机制。
