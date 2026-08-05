# 从 MCP 原理到真实 Server：我把 Tool、Resource、Prompt 和错误边界跑通了

昨天我写了一篇文章：[《我写过 MCP Server，却一直以为 MCP 只有 Tool》](https://juejin.cn/spost/7669999915607982134)。

那篇文章解决的是 MCP 的整体架构问题：

- Host、MCP Client、MCP Server 分别负责什么；
- stdio 与 Streamable HTTP 如何改变部署拓扑；
- Token 应该保存在哪里；
- 为什么凭证和权限校验必须发生在真实副作用之前；
- MCP、API、Tool、Skill 和 Plugin 有什么区别。

文章最后，我给自己留下了一个明确的下一步：

> 实现并真实接入一次 MCP Server，完成能力发现与调用，区分只读和写入权限，并观察调用失败时各层如何返回结果。

昨天还有一个没有完成的问题：我虽然知道 MCP Server 可以暴露 Tool、Resource 和 Prompt，但 Resource、Prompt 仍然停留在概念层，没有真正注册、发现和读取过。

所以今天不是重新学习 MCP，而是继续完成昨天留下的实践：

```text
昨天：看懂 MCP 的角色和信任边界
今天：把这些边界放进真实 SDK 中运行
```

## 从架构图进入真实 SDK

昨天的 Demo 是一个确定性的本地模型。

它没有使用真实 MCP SDK，主要用于验证：

- stdio 与 HTTP 的部署拓扑；
- Token 是否进入 LLM 上下文；
- 权限校验是否发生在下游 API 调用之前。

今天的 Demo 则使用官方 TypeScript SDK，创建了一个真正可以被 MCP Client 发现和调用的 Server。

```js
import { McpServer }
  from "@modelcontextprotocol/sdk/server/mcp.js";

import { StdioServerTransport }
  from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "学习用项目查询 MCP Server",
  version: "1.0.0",
});
```

最后把 Server 连接到 stdio Transport：

```js
await server.connect(
  new StdioServerTransport(),
);
```

这两步分别解决：

```text
new McpServer(...)
→ 创建并承载 MCP 协议能力

server.connect(transport)
→ 让 Client 可以通过具体传输通道连接 Server
```

在今天的 stdio 场景中，MCP Client 会启动 `server.mjs` 子进程，再通过标准输入输出通信。

这正好承接了昨天的结论：

> stdio 下通常由 Client 一侧的 Transport 启动本地 Server 子进程，但 Client 和 Server 仍然是两个协议角色，也可以是两个独立进程。

## 发现 Tool 与执行 Tool 是两次请求

Server 注册了两个 Tool：

```text
get_project_by_name
archive_project
```

Client 连接成功后，先执行：

```js
const tools = await client.listTools();
```

输出：

```text
[
  "get_project_by_name",
  "archive_project"
]
```

这只能证明 Client 发现了 Server 提供的工具。

Server 返回的是工具名称、说明、输入结构和 annotations，并没有进入工具处理器。

真正执行工具，需要调用：

```js
const result = await client.callTool({
  name: "get_project_by_name",
  arguments: {
    projectName: "ai-learning-agent",
  },
});
```

完整过程是：

```text
tools/list
→ Client 发现 Server 有哪些 Tool

tools/call
→ Client 指定 Tool 和参数
→ Server 路由到对应处理器
→ 处理器执行
→ 返回 Tool Result
```

因此，`tools/list` 成功不能证明 Tool 已经被执行，更不能证明 Tool 的所有参数、权限和业务路径都正确。

## 昨天的信任边界，今天变成了 Server 代码

昨天我验证的是 Token 和下游 API 之间的边界。

今天进一步验证的是：如果 MCP Client 不遵守 Tool annotations，谁来阻止写操作？

写入 Tool 声明了：

```js
annotations: {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
}
```

这些字段可以提示 Client：

- 当前 Tool 不是只读的；
- 可能产生破坏性影响；
- 重复执行预期具有幂等性。

但它们只是提示，不是权限系统。

一个自定义 Client 完全可能忽略 `destructiveHint`，直接发送 `tools/call`。

因此，真正的读写权限判断仍然放在 Server 处理器中：

```js
if (process.env.MCP_ACCESS_MODE !== "read-write") {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: "权限不足：当前连接只有只读权限",
      },
    ],
  };
}
```

只有通过校验，代码才会继续产生副作用：

```js
project.archived = true;
```

实际顺序是：

```text
Client 发起 tools/call
→ Server 收到请求
→ Server 校验当前访问模式
→ 只读连接立即返回
→ 读写连接才修改项目状态
```

这和昨天“必须在 GitLab API 请求前拦截不安全凭证”的结论属于同一条原则：

> 不能绕过的约束，必须放在副作用发生之前，并由可信执行层确定性实现。

区别只是昨天的可信边界位于 MCP Server 与下游 API 之间，今天的边界位于 Tool 处理器内部。

## MCP Server 不一定只是转发网关

以前我可能会把 Tool 参数直接丢给下游 API，然后根据 API 的成功或失败返回结果。

今天重新看这条链路，我发现 MCP Server 本身也是一个服务。

它可以负责：

- 校验 Tool 输入；
- 判断当前连接权限；
- 控制副作用；
- 转换下游错误；
- 组织 Tool Result；
- 直接执行部分业务逻辑。

它确实可以像网关一样连接下游 API，但它不一定只是网关。某些 Tool 处理器本身就承载业务逻辑，不需要再转发其他服务。

因此，更准确的理解是：

```text
MCP Server
= MCP 协议适配
+ 能力注册
+ 请求路由
+ 服务端校验
+ Tool 处理器
+ 可选的下游 API 调用
```

## Tool 执行失败与协议错误属于不同层

今天还运行了两个失败案例。

### 已找到 Tool，但业务执行失败

第一个案例调用已经注册的 Tool，只是查询了不存在的项目：

```js
await client.callTool({
  name: "get_project_by_name",
  arguments: {
    projectName: "not-exists",
  },
});
```

Server 已经成功路由到 Tool 处理器，只是业务上没有找到目标项目。

返回结果是：

```js
{
  content: [
    {
      type: "text",
      text: "未找到项目：not-exists",
    },
  ],
  isError: true,
}
```

这里仍然返回 Tool Result。

`isError: true` 表示 Tool 已经被调用，但执行结果是失败。

### Server 无法路由 JSON-RPC 方法

第二个案例故意发送一个 Server 不认识的方法：

```js
await client.request(
  {
    method: "demo/not-found",
    params: {},
  },
  z.unknown(),
);
```

Client 捕获到：

```js
{
  name: "McpError",
  code: -32601,
  message: "MCP error -32601: Method not found",
}
```

这次请求没有进入任何 Tool 处理器，而是在 JSON-RPC 方法路由阶段失败。

两者可以这样区分：

| 场景 | 是否进入 Tool 处理器 | 结果 |
| --- | --- | --- |
| 查询不存在的项目 | 是 | Tool Result，`isError: true` |
| 调用不存在的方法 | 否 | JSON-RPC 协议错误 `-32601` |

昨天我主要关注“错误是否发生在真实 API 调用之前”。

今天则继续把错误位置拆成：

```text
协议和路由层
→ Tool 输入与权限校验层
→ Tool 业务执行层
→ 下游 API 层
```

只有先知道失败发生在哪一层，才知道应该修协议、修参数、补权限，还是处理业务错误。

## JSON-RPC 是 MCP 请求的基础信封

今天也是我第一次具体接触 JSON-RPC。

MCP SDK 已经封装了大部分 JSON-RPC 细节，所以平时只需要调用：

```js
client.listTools();
client.callTool(...);
```

但底层请求仍然需要表达：

- 这是哪个版本的 JSON-RPC；
- 当前请求 ID 是什么；
- 调用哪个方法；
- 参数是什么。

例如：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_project_by_name",
    "arguments": {
      "projectName": "ai-learning-agent"
    }
  }
}
```

成功时返回 `result`：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {}
}
```

协议错误时返回 `error`：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32601,
    "message": "Method not found"
  }
}
```

JSON-RPC 不负责定义“项目是否存在”这种业务规则。

它解决的是：

```text
请求调用什么方法
→ 携带什么参数
→ 成功结果对应哪个请求
→ 协议失败如何表达
```

MCP 则在这套请求响应结构上定义了 `tools/list`、`tools/call`、`resources/read`、`prompts/get` 等具体能力。

## 把昨天没完成的 Resource 跑通

昨天我只知道 Resource 是 Server 提供的可读取上下文，今天终于真正注册并读取了一次。

Server 注册了一份项目目录：

```js
server.registerResource(
  "project_catalog",
  "project://catalog",
  {
    title: "项目目录",
    description: "MCP Server 当前管理的项目资料。",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(projects, null, 2),
      },
    ],
  }),
);
```

Client 先发现 Resource：

```js
const resources = await client.listResources();
```

输出：

```text
project://catalog
```

再读取：

```js
const result = await client.readResource({
  uri: "project://catalog",
});
```

返回项目目录：

```json
[
  {
    "name": "ai-learning-agent",
    "visibility": "private",
    "archived": false
  },
  {
    "name": "ai-learning-notes",
    "visibility": "public",
    "archived": false
  }
]
```

这里最重要的认知是：

> Resource 注册成功，不代表它已经进入 LLM 上下文。

完整过程是：

```text
resources/list
→ Client 或 Host 发现 Resource

resources/read
→ 读取指定 URI 的内容

Host
→ 决定是否把内容交给 LLM
```

Resource 表达的是一份由 Server 提供、可以通过 URI 定位和读取的资料，例如：

- 使用规范；
- 项目目录；
- 数据库 Schema；
- 公司制度；
- 配置快照。

它不是必须产生一次业务动作的 Tool。

## 把昨天没完成的 Prompt 跑通

Server 还注册了一个项目审查 Prompt：

```js
server.registerPrompt(
  "review_project",
  {
    title: "项目审查模板",
    description: "生成一条供用户选择使用的项目审查消息。",
    argsSchema: {
      projectName: z
        .string()
        .min(1)
        .describe("需要审查的项目名称"),
    },
  },
  ({ projectName }) => ({
    description: `审查项目 ${projectName}`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `请审查项目 ${projectName}，` +
            "说明它的可见性、归档状态和潜在风险。",
        },
      },
    ],
  }),
);
```

Client 先发现 Prompt：

```js
const prompts = await client.listPrompts();
```

再传入项目名：

```js
const result = await client.getPrompt({
  name: "review_project",
  arguments: {
    projectName: "ai-learning-agent",
  },
});
```

返回：

```js
{
  role: "user",
  content: {
    type: "text",
    text:
      "请审查项目 ai-learning-agent，" +
      "说明它的可见性、归档状态和潜在风险。",
  },
}
```

运行到这里时：

- 没有调用 LLM；
- 没有读取项目目录；
- 没有完成项目审查；
- 没有执行任何写操作。

Prompt 只是根据参数生成了一条结构化任务消息。

之后才可能继续：

```text
用户选择 Prompt
→ Client 调用 prompts/get
→ Host 把返回的消息交给 LLM
→ Host 读取 Resource 或调用查询 Tool
→ LLM 生成审查结果
→ 用户确认
→ Tool 执行写操作
```

因此我现在会这样区分三类能力：

```text
Prompt
→ Server 提供的标准任务模板

Resource
→ Server 提供的可读取资料

Tool
→ Server 提供的可执行能力
```

## 为什么理解以后，我反而不想强行使用它们

昨天知道 Resource 和 Prompt 的存在以后，我一度担心：

> 如果真实 MCP Server 基本都只使用 Tool，那么 Resource 和 Prompt 是否只是协议定义出来、实际很少有人使用的能力？

今天理解完整调用链后，我认为确实不应该为了“完整”而强行加入三种能力。

Codex、Claude Code 等 Host 本身已经拥有：

- 自然语言入口；
- Skill；
- 命令；
- Prompt 文件；
- 本地上下文；
- 文件和知识库读取能力。

这些能力会与 MCP Resource、Prompt 产生功能重叠，因此 Tool 在现实 Agent 场景中通常更直接、更常见。

但 Resource 和 Prompt 仍然有自己的适用边界：

- 资料明确属于某个 MCP Server，并且应该随 Server 一起维护时，使用 Resource；
- 标准任务入口属于某个 MCP Server，并且需要被多个 Host 复用时，使用 Prompt；
- 需要执行查询、计算、写入或产生副作用时，使用 Tool。

所以正确结论不是：

```text
Resource 和 Prompt 没有用
```

而是：

```text
没有对应的数据所有权和复用需求时，
不需要为了凑齐 MCP 能力而强行设计 Resource、Prompt。
```

## 从昨天到今天，我补齐的是哪一段

昨天我理解了 MCP 的角色和信任边界：

```text
用户
→ Host
→ MCP Client
→ Transport
→ MCP Server
→ 下游 API
```

今天则把 Server 内部继续展开：

```text
MCP Server
├── Tool
│   ├── tools/list
│   ├── tools/call
│   ├── 权限校验
│   └── Tool Result
├── Resource
│   ├── resources/list
│   └── resources/read
└── Prompt
    ├── prompts/list
    └── prompts/get
```

我还通过失败案例看到了：

```text
JSON-RPC 协议错误
≠ Tool 业务执行失败
≠ 下游 API 失败
```

所以今天不是重新学习一遍 MCP，而是把昨天停留在架构图上的角色和边界，真正放进官方 SDK 中运行了一次。

昨天解决的是：

> MCP 的参与者是谁，信任边界在哪里？

今天解决的是：

> MCP Server 具体怎样注册、发现、执行和返回能力？失败时又怎样判断错误发生在哪一层？

完整 Demo：

[2026-08-05 实现并接入 MCP Server](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-05-mcp-server)

运行方式：

```bash
npm install
npm run demo
npm run demo:write
npm run demo:failures
npm run demo:all
```

下一步，我会从“怎样实现一个 Agent 能力”进入“怎样证明这个 Agent 修改以后真的变好了”：建立固定任务样本，评测工具选择、参数、检索、引用、拒答和任务成功率。

官方参考：

- [MCP 架构说明](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP Server 概念](https://modelcontextprotocol.io/docs/learn/server-concepts)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
