# 实现并接入 MCP Server

这是 L22 的逐步实践 Demo。第一步只建立一条最小、真实的 MCP 链路：

1. `client.mjs` 通过 stdio 启动并连接 `server.mjs`。
2. Client 调用 `tools/list`，发现 Server 注册的只读工具。
3. Client 调用 `tools/call`，Server 校验输入并执行工具处理器。
4. Server 返回结构化的 MCP Tool Result。

运行：

```bash
npm install
npm run demo
```

## 读写权限

只读模式会发现两个工具，但 Server 会拒绝写操作：

```bash
npm run demo
```

读写模式允许执行归档：

```bash
npm run demo:write
```

`annotations` 中的 `readOnlyHint`、`destructiveHint` 和 `idempotentHint` 只是向 Client 描述行为的提示。真正的权限判断在 `archive_project` 的 Server 端处理器中完成。

## 失败处理

运行两种失败：

```bash
npm run demo:failures
```

- 查询不存在的项目：工具已正常进入处理器，但业务执行失败，因此返回 `isError: true` 的 Tool Result。
- 发送 Server 无法路由的 JSON-RPC 方法：Client 捕获协议错误。需要注意，当前高层 `McpServer` SDK 会把一部分工具调用异常包装为 `isError: true`，所以判断时要以所用 SDK 的实际边界为准。

当前 Demo 已覆盖“实现 Server + 真实发现与调用 + 读写权限 + 失败处理”。

## Tool、Resource、Prompt 完整能力

运行：

```bash
npm run demo:all
```

这条命令会实际完成六次 MCP 操作：

1. `tools/list`：发现可执行能力。
2. `tools/call`：调用只读 Tool 查询项目。
3. `resources/list`：发现 Server 提供的资源 URI。
4. `resources/read`：读取 `project://catalog` 的项目资料。
5. `prompts/list`：发现 Server 提供的 Prompt 模板。
6. `prompts/get`：传入项目名，取得组装好的结构化消息。

三类能力的边界：

- Tool：执行动作或计算。
- Resource：通过 URI 暴露可读取的数据。
- Prompt：返回可供用户选择使用的结构化消息模板；获取 Prompt 本身不会调用 LLM。
