# 模型返回了 JSON，为什么还不能调用工具？Runtime 的结构化输出校验链路

昨天我写了一篇文章：[《第一次真正调用 LLM 后，我看清了 Runtime、SDK 和模型的边界》](https://juejin.cn/spost/7663456780569215002)。

那篇文章最后，我给自己留下了一个下一步：

> 继续学习结构化输出和 Schema 校验：当模型返回的内容不符合预期时，应该在哪一层拒绝、修复、重试或终止。

昨天真实调用 DeepSeek API 时，我已经看到：HTTP 请求成功，不代表模型返回的内容一定完整。比如 `finish_reason: "length"` 表示输出可能因为 Token 上限被截断。

但今天继续往下追，我发现还要再多问一步：

> 即使模型成功返回了一段 JSON，它就可以直接进入工具调用吗？

答案是否定的。

模型返回的 JSON 只是一个候选值。它必须经过 Runtime 的解析、Schema 校验和业务判断，才有资格变成一次真实行动。

## 合法 JSON，不等于符合 Schema

先看一个模型输出：

```json
{
  "city": "北京",
  "temperature": "18",
  "note": "晴"
}
```

它是合法 JSON，`JSON.parse()` 可以成功。

但假设 Runtime 使用的 Schema 是：

```json
{
  "type": "object",
  "properties": {
    "city": {
      "type": "string"
    },
    "temperature": {
      "type": "number"
    }
  },
  "required": ["city", "temperature"],
  "additionalProperties": false
}
```

这份输出仍然不能通过：

- `temperature` 应该是 `number`，实际却是字符串；
- `note` 没有在 `properties` 中声明，而 Schema 禁止额外字段。

这让我先把两个层次分开了：

```text
JSON 解析
→ 判断是不是合法 JSON

Schema 校验
→ 判断这个 JSON 是否符合程序约定的结构
```

TypeScript 类型只能约束开发阶段的代码，不能证明真实模型返回的数据一定符合类型。模型输出属于外部输入，Runtime 仍然需要在运行时校验。

## 通过 Schema，也不代表业务上有效

我一开始还误解了 `required`。

假设模型返回：

```json
{
  "city": "",
  "temperature": 18
}
```

而 `city` 已经被放进 `required`。

我最初认为空字符串不能通过，因为 `city` 是必填字段。但 `required` 只要求这个属性存在。空字符串仍然是一个存在的字符串，所以它可以通过当前 Schema。

继续增加：

```json
{
  "type": "string",
  "minLength": 1
}
```

也不一定够。

下面这个值仍然可能通过：

```json
{
  "city": " "
}
```

因为 JSON Schema 不会自动调用 `trim()`。一个空格的字符串长度仍然是 1。

如果业务规则要求城市名去掉首尾空格后不能为空，那么这个判断属于业务语义校验：

```js
if (city.trim().length === 0) {
  throw new Error("INVALID_CITY");
}
```

到这里，完整链路变成：

```text
模型原始输出
→ JSON 解析
→ Schema 校验
→ 业务语义与权限校验
→ 真实工具调用
```

模型输出只有通过前面的所有门槛，才能进入工具。

## 为什么最终门槛必须放在 Runtime？

模型可以按照提示词生成 JSON，模型 API 也可能提供结构化输出能力。

这些能力可以减少错误，但不能代替 Runtime 的最终判断。

原因很直接：不能再让模型自己决定“模型刚才的输出是否安全”。

模型认为自己的输出符合要求，只是一段新的模型判断。只有 Runtime 中真正执行的校验代码通过，系统才能确定：

- JSON 确实能够解析；
- 字段和类型符合当前 Schema；
- 没有未授权的额外字段；
- 值符合本次用户请求；
- 当前用户有权执行对应工具；
- 工具参数满足真实业务约束。

因此，模型输出应该被当作不可信的外部输入。

这和处理表单、接口响应或第三方 Webhook 很像：数据看起来合理，不代表程序可以跳过校验。

## `reject` 之后，才决定如何恢复

发现无效输出后，第一件事是拒绝当前候选，不让它进入工具。

但 `reject` 只回答了“当前输出能不能继续”，还没有回答“接下来怎么办”。

接下来可能有三种恢复动作：`repair`、`retry` 和 `terminate`。

### 可以确定修复时，使用 `repair`

假设用户明确要求摄氏度，而模型输出：

```json
{
  "city": "北京",
  "unit": "C"
}
```

Schema 只接受：

```text
celsius
fahrenheit
```

如果 Runtime 中存在经过批准的白名单映射：

```text
C → celsius
```

那么这次转换是确定的，不需要重新调用模型。

但修复后的对象不能直接进入工具。它是一个新的候选，仍然要重新经过：

```text
Schema 校验
→ 业务语义校验
→ 工具调用
```

否则，Runtime 可能只修好了 `unit`，却漏掉对象中的其他错误。

### 有新的纠错信息时，使用 `retry`

如果模型输出了 `kelvin`，而用户原话明确要求摄氏度，Runtime 可以把最小纠错信息发送给模型：

```json
{
  "path": "unit",
  "expected": "celsius",
  "actual": "kelvin"
}
```

这里不应该只告诉模型：

```text
unit 必须是 celsius 或 fahrenheit
```

因为模型下一次可能改成 `fahrenheit`。它虽然通过 Schema，却仍然违反用户要求。

所以重试反馈不只要包含 Schema 错误，还要保留本次请求中已经确认的业务事实。

昨天验证过的 `finish_reason: "length"` 也是一个可能重试的场景。如果输出因为 `max_tokens` 被截断，而系统还有预算，那么调整输出上限后重新请求，下一次结果确实可能不同。

### 根因不会变化时，使用 `terminate`

如果上下文中根本没有城市信息，再调用一次模型也不会凭空得到正确城市。

如果模型请求使用 Schema v1，而 Runtime 错误地使用 Schema v2 校验，那么再次调用模型仍然会按照 v1 生成。

这些情况下，重试不会改变失败原因，只会浪费一次模型调用。

因此我现在认为，重试至少要满足两个条件：

```text
仍有重试预算
并且
下一次调用能够获得新的纠错信息或不同的执行条件
```

只剩重试次数，不代表应该重试。

## 给模型的信息和 Runtime 的审计记录不是一回事

学习过程中，我把这两个方向混在了一起。

模型需要的是完成纠错所必需的信息，例如：

```json
{
  "path": "unit",
  "expected": "celsius",
  "actual": "kelvin"
}
```

它不需要知道：

- Node.js 的完整调用栈；
- 服务器文件路径；
- validator 的内部对象；
- Runtime 的全部审计信息。

Runtime 为了追溯修复过程，则需要记录：

```text
模型原始值
→ 执行的修复规则和版本
→ 修复后的值
→ 重新校验的结果
```

但这里的“保留记录”也不等于把所有数据明文写进日志。Token、密码等敏感字段仍然需要脱敏、摘要化或使用安全引用。

所以更准确的原则是：

```text
给模型：安全且足够纠错的最小信息
给 Runtime：必要、可追溯且经过脱敏的审计证据
```

## Schema 本身也可能在 Runtime 中失效

今天还接触了几个以前没有系统区分的 JSON Schema 规则。

`oneOf` 要求输入恰好匹配一个分支。

如果一个对象同时匹配两个分支，它不会“变成 `anyOf`”，而是直接导致 `oneOf` 校验失败。只有 Schema 本身使用 `anyOf` 时，匹配一个或多个分支才允许通过。

在 Draft 2020-12 的组合 Schema 中，`additionalProperties` 和 `unevaluatedProperties` 也有不同作用。

当属性通过 `$ref` 或 `allOf` 被其他子 Schema 评估时，根节点的 `additionalProperties: false` 可能仍然把它当成额外字段。`unevaluatedProperties: false` 可以综合已经成功执行的子 Schema，再拒绝真正没有被评估的属性。

但这条规则能否生效，还取决于生产环境中的 validator。

如果 Schema 按 Draft 2020-12 编写，而 Runtime 的 validator 只支持 Draft-07，那么依赖的新关键词可能无法执行，甚至可能被忽略。

因此，Schema 也需要发布前验证：

```text
模型侧与 Runtime 是否使用同一个版本化 Schema
→ validator 是否支持对应 dialect
→ 非法输入的负向测试是否真的失败
→ 不支持时阻止服务就绪或发布
```

如果只记录 warning 后继续运行，所谓的 Runtime 硬门槛可能只是设计文档中的硬门槛。

## 我今天真正学会了什么？

昨天我已经知道，一次真实模型请求可能在应用、Node.js、SDK、鉴权、模型生成或响应解析等不同位置失败。

今天，我把模型生成之后的链路继续拆细了：

```text
模型生成原始内容
→ Runtime 检查结束原因
→ 解析 JSON
→ 校验 Schema
→ 校验业务语义与权限
→ 决定 reject、repair、retry 或 terminate
→ 全部通过后才调用工具
```

以前我会把“模型返回了 JSON”理解成程序已经拿到了结构化结果。

现在我更愿意把它理解为：

> 程序拿到了一个具有 JSON 外形、但仍未取得执行资格的候选值。

模型负责生成候选；Runtime 负责决定候选是否可以变成真实行动。

下一步，我会继续进入真实 Tool Calling：观察模型第一次提出工具调用后，Runtime 怎样执行工具、保存结果，并把工具结果交给模型完成第二次调用。