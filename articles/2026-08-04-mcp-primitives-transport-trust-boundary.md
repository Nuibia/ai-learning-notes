# 我写过 MCP Server，却一直以为 MCP 只有 Tool

我很早就写过一个 GitLab MCP Server。

当时我找到官方 SDK，创建 Server，再用 TypeScript 和 Zod 注册了几个工具：

- 获取 GitLab 项目列表
- 按分支名搜索项目
- 按项目名搜索项目

它后来也确实被 Agent 使用过。平时我还经常使用 Notion、Figma 等 MCP，所以我一直觉得自己“用过 MCP”。

但今天重新学习 MCP 的原理时，我才发现：我过去的实践虽然是真的，认知却不完整。

我一直把 Tool 当成了 MCP 的全部。

## MCP 不只是 Tool

MCP 的全称是 Model Context Protocol，即模型上下文协议。

它解决的核心问题是：让支持 MCP 的应用能够按照统一协议发现和使用外部能力，而不需要为每个 Agent 单独设计一套工具接入方式。

MCP Server 可以暴露三类核心能力：

| 类型 | 作用 | 我的理解 |
| --- | --- | --- |
| Tool | 执行操作 | 查询 GitLab 项目、创建 Issue、修改数据 |
| Resource | 提供可读取的数据 | 项目说明、仓库内容、当前用户可访问的资料 |
| Prompt | 提供可复用的提示模板 | 代码评审模板、项目分析模板、固定任务入口 |

我过去写的 GitLab MCP 只注册了 Tool，日常使用 MCP 时，我关注的也一直是 Agent 能调用哪些工具。因此在我的实际认知里，MCP 几乎等同于“为 Agent 统一接入工具的协议”。

直到今天我才知道，MCP Server 除了可以提供 Tool，还可以提供 Resource 和 Prompt。我并不是研究后认定 MCP 只有 Tool，而是过去的实践范围一直停留在 Tool，没有意识到协议还定义了另外两类能力。

目前我对 Resource 和 Prompt 还停留在概念理解，真正的使用场景与实现方式，留到后面的 MCP 实践中验证。

## Host、Client 和 Server 到底分别是谁

学习过程中，另一个让我迷惑的词是 MCP Client。

我最初会把它理解成平时说的“客户端应用”，于是产生了这样的认知：

> MCP Server 运行在 MCP Client 里面。

这句话在某些本地运行场景下看起来很像事实，但它混淆了角色和进程的关系。

以 Codex 调用 GitLab MCP 为例，完整链路是：

```text
我
  → Codex（Host）
  → Codex 内部的 MCP Client
  → Transport
  → GitLab MCP Server
  → GitLab API
```

Host 是 MCP 官方架构中的角色。这里可以直接把它理解成承载并协调 Agent、MCP Client 和用户交互的应用，例如 Codex。

MCP Client 则是 Host 内负责连接某一个 MCP Server 的协议组件。它负责初始化连接、发现能力、发送 `tools/call` 请求和接收结果。

真正执行 GitLab 查询逻辑的是 GitLab MCP Server。Server 内部的 Tool 处理器再去请求 GitLab API。

因此，LLM 负责理解用户意图和选择能力，MCP Client 负责协议通信，MCP Server 负责执行对应处理器。它们不是同一层。

## stdio 和 Streamable HTTP 改变的是连接方式

我原来认为“Server 运行在 Client 上”，主要来自 stdio 的使用体验。

在 stdio 模式下，通常是 MCP Client 所在的应用启动本地 MCP Server 子进程，然后通过标准输入输出通信：

```text
Codex
  → MCP Client
  → 启动本地 GitLab MCP Server
  → stdin/stdout 通信
```

因此从进程生命周期看，本地 Server 的确可能由 Client 一侧启动和管理。

但在 Streamable HTTP 模式下，结构就不同了：

```text
Codex MCP Client
  → 连接 https://mcp.company.com
  → 已经独立部署的 GitLab MCP Server
```

远程 Server 由公司的部署系统负责启动和维护。Codex 内的 MCP Client 只负责连接它，不负责启动它。

两种方式改变的是 Transport 和部署拓扑，并没有改变 Client 与 Server 的职责。

## Token 不应该进入 LLM 上下文

MCP 的信任边界不只是“能不能连接成功”，还包括凭证到底经过哪些组件。

调用 GitLab API 时需要 Token，但 LLM 并不需要知道这个 Token。

理想链路应该是：

```text
LLM 看到：
- 用户问题
- Tool 描述
- Tool 参数结构
- 本次调用参数

LLM 看不到：
- GitLab Token
- Authorization 请求头
- 服务端环境变量
```

在 stdio 场景下，凭证可以通过 Server 的运行环境注入。

在远程 HTTP 场景下，访问凭证应通过标准的 `Authorization: Bearer <token>` 请求头传递，不能放进 URL 查询参数。

原因不只是“看起来不安全”。URL 可能进入浏览器历史、反向代理日志、访问日志或监控系统。即使使用 HTTPS，查询参数在到达代理或服务端并被解密后，仍可能被这些系统记录。

因此 Demo 中专门加入了一个错误场景：

```js
if (url.searchParams.has("token")) {
  throw new Error("access token 不得进入 URI query string");
}
```

而且这个校验必须发生在真正调用 GitLab API 之前。否则即使 MCP Server 最后报告失败，下游副作用也可能已经发生。

## 我用三个场景验证了这条边界

今天的 Demo 没有连接真实 GitLab，也没有读取真实凭证，而是用本地模拟验证三种情况。

运行方式：

```bash
node demo.mjs stdio
node demo.mjs http-safe
node demo.mjs http-unsafe
```

三个场景的结果分别是：

1. `stdio`

   MCP Client 的 stdio transport 启动本地 Server，GitLab API 被调用一次。

2. `http-safe`

   Server 已由公司部署系统启动，Client 使用 Authorization 请求头连接，GitLab API 被调用一次。

3. `http-unsafe`

   Token 被故意放入 URL 查询参数，Server 在下游 API 调用前拒绝请求，GitLab API 调用次数为零。

三个场景还会共同检查：Token 没有进入模拟的 LLM 上下文。

完整 Demo：

[2026-08-04 MCP 原理与信任边界实验](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-04-mcp-trust-boundary)

这个 Demo 是一个确定性的本地模型，不是生产级 MCP SDK 示例。它的目的不是教我复制框架代码，而是把 Client、Server、Transport、API 与凭证边界真正跑清楚。

## MCP、API、Tool、Skill 和 Plugin 不是一回事

以 GitLab 场景为例，这几个概念可以这样区分：

| 概念 | GitLab 场景中的职责 |
| --- | --- |
| API | GitLab 对外提供的 HTTP 接口 |
| Tool | Agent 可以调用的“按项目名查询”等具体能力 |
| MCP | Client 发现和调用 Server 能力的统一协议 |
| Skill | 告诉 Agent 什么时候调用、按什么流程处理的说明 |
| Plugin | 把 Skill、MCP Server 等能力进行安装、分发和版本管理的载体 |

Skill 可以定义流程，但它本身不会自动产生 GitLab 数据修改。

真正的副作用通常由 MCP Server 中的 Tool 处理器调用 GitLab API 产生。Plugin 则可以把 Skill 和 MCP Server 一起交付，但它也不等于 MCP。

## 我今天真正修正的认知

我并不是第一次使用 MCP，而是第一次把自己过去的 MCP 实践放回完整架构中理解。

过去我的实现只有 Tool，所以我以为 Tool 就是 MCP；过去 stdio 会启动本地进程，所以我以为 Server 运行在 Client 中；过去我知道 Token 应该放在环境变量里，但没有真正把 LLM、Client、Server 和 API 之间的凭证边界解释清楚。

今天我确认了：

- MCP Server 不只可以暴露 Tool，还可以暴露 Resource 和 Prompt。
- Host、MCP Client、MCP Server 是不同角色。
- stdio 与 Streamable HTTP 改变的是连接和部署方式，不改变角色职责。
- LLM 负责理解和选择，不应该接触登录凭证。
- 凭证校验必须发生在产生下游副作用之前。
- MCP、API、Tool、Skill 和 Plugin 各自解决不同问题。

下一步不是继续背概念，而是实现并真实接入一次 MCP Server：完成能力发现与调用，区分只读和写入权限，并观察调用失败时各层如何返回结果。

官方参考：

- [MCP 架构说明](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP Server 概念](https://modelcontextprotocol.io/docs/learn/server-concepts)
- [MCP Authorization 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
