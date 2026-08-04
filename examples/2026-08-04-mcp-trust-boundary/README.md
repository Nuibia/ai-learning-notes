# L21：MCP 原理与信任边界实验

这是 2026-08-04 的独立教学 Demo。它不连接真实 GitLab，也不读取任何真实凭证；通过三个可运行场景观察同一 MCP Server 在不同 Transport 下的生命周期和凭证边界。

## 运行三个场景

```bash
node demo.mjs stdio
node demo.mjs http-safe
node demo.mjs http-unsafe
```

重点比较输出中的两项：

- `Server 生命周期负责人`
- `GitLab API 实际请求次数`

## 代码中的真实角色

```text
用户
  → Host / LLM
  → MCP Client
  → stdio 或 Streamable HTTP Transport
  → GitLab MCP Server
  → GitLab API
```

- `stdio`：MCP Client 的 Transport 启动本地 Server 子进程，并通过环境变量注入模拟凭证。
- `http-safe`：公司部署系统提前启动远程 Server；MCP Client 只连接它，并把凭证放进 `Authorization` 请求头。
- `http-unsafe`：故意把 token 放进 URL 查询参数；Server 在调用 GitLab API 前拒绝请求。
- 三种模式都保证 LLM 上下文中不存在 token。

## 对应概念

| 概念 | 本 Demo 中的对象 |
| --- | --- |
| API | `FakeGitLabApi.getProjectByName()` |
| Tool | `get_project_by_name` 及其参数结构 |
| MCP | Client 发现 Tool、发送 `tools/call`、接收结果的统一约定 |
| Skill | 教 Agent 何时以及按什么流程使用能力；本 Demo 不伪造 Skill 执行器 |
| Plugin | 可把 Skill 与 MCP Server 一起安装、分发和版本化；本 Demo 不伪造 Plugin Runtime |

## 素材边界

- 本地真实参考仓库：`/Users/anhongfei/project/gitlab-mcp-server`。
- 真实仓库 Git 历史曾出现硬编码访问凭据，因此这里只保留脱敏模拟，不复制真实 token、内网地址或历史内容。
- Demo 使用固定假 token，且不会打印它，也不会发起网络请求。

官方依据：

- <https://modelcontextprotocol.io/docs/learn/architecture>
- <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>
