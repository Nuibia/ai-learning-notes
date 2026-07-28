# L13：Node Agent 后端与聊天 UI 全链路

这是一个无第三方依赖的可运行 Demo，用来观察：

```text
聊天 UI
  → POST /api/messages
  → Node Runtime 保存 run
  → 模型 Stub 返回工具意图
  → Runtime 持久化 waiting_confirmation
  → SSE confirmation.required
  → 用户点击人工确认
  → POST /confirm
  → Runtime 幂等执行工具
  → SSE tool.completed / response.completed
  → UI 渲染结果
```

模型使用可控 Stub，不调用真实模型 API。本章验证的是 Agent Runtime 与聊天 UI 的职责和事件链，而不是模型效果。

## 术语来源

本 Demo **没有使用 DeepSeek，也不代表社区 Agent 的统一协议**。为了让事件链可观察，下面多数英文名都是 Demo 自定义契约：

| 名称 | 标签 | 说明 |
|---|---|---|
| `tool call` | 模型 API 通用概念 | 模型提出结构化工具调用；不同供应商的字段可能不同 |
| `streaming`、`waiting_confirmation`、`executing`、`completed` | Demo 自定义状态 | 只属于本 Demo 的状态机命名 |
| `pendingIntent` | Demo 自定义字段 | 暂存尚未执行的工具意图 |
| `request.accepted`、`model.tool_call`、`confirmation.required` 等 | Demo 自定义事件 | 只属于本 Demo 的 SSE 事件协议 |
| `idempotencyKey` | 通用工程概念 + Demo 自定义字段 | “幂等键”是通用概念，具体字段名与生成方式由 Runtime 自己定义 |

阅读代码时，应先看标签，再理解名字；不要把 Demo 自定义状态或事件当成 DeepSeek、OpenAI 或其他社区框架的标准术语。

## 实现边界

这个最小 Demo 用 `Map` 保存 run、工具结果和事件，只保证**单个 Node 进程存活期间**的状态一致性，不具备磁盘或数据库持久化能力。进程重启后状态会丢失，因此不能用它推断崩溃恢复行为。若要验证重启恢复，需要把状态仓库替换为文件或数据库，并另外定义原子写入与恢复规则。

## 运行 UI

```bash
node server.mjs
```

浏览器打开 <http://localhost:3000>。

## 运行测试

```bash
node --test runtime.test.mjs
```

## 查看完整生命周期

```bash
node trace.mjs
```

它会依次打印 `createRun`、第一次人工确认和重复确认后的 run 状态、工具结果、执行次数与事件列表。

测试验证：

- 人工确认前工具执行次数为 0；
- 确认后的事件顺序完整；
- 重复确认不会重复执行工具。

## 文件职责

- `runtime.mjs`：状态机、模型 Stub、工具执行和幂等控制；
- `server.mjs`：HTTP 与 SSE 传输层；
- `public/index.html`：聊天操作、人工确认和事件渲染；
- `trace.mjs`：从创建 run 到重复确认的完整生命周期；
- `runtime.test.mjs`：确认门与重复请求的机器证据。

## 证据边界

Demo 由 AI 生成，运行结果属于工程证据，不自动成为学习者的掌握证据。学习证据仍来自学习者对代码的检查、预测、修改和解释。
