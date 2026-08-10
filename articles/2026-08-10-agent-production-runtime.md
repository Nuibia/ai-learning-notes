# Agent 已经能测、能追踪了，我才发现这还不等于能上线

上一篇文章中，我记录了自己对 [Eval、Guardrails 和 Trace](https://juejin.cn/spost/7670798157669335086) 的理解。

那次学习让我从“Agent 能不能完成任务”，走到了“怎样判断 Agent 是否可靠”：

- Eval 用固定样本发现版本退化；
- Guardrails 在 Runtime 中阻断危险行为；
- Trace 记录 Agent 实际经过了哪些步骤，以及失败发生在哪里。

学完以后，我原本觉得 Agent 的主要链路已经比较完整了。

但当我继续学习部署与生产化时，又遇到了一个很现实的问题：

> 即使 Agent 已经通过 Eval，也能追踪每一次执行，它真的可以直接上线吗？

答案显然是否定的。

如果访问令牌进入模型上下文怎么办？请求突然增多怎么办？工具一直不返回怎么办？队列不断积压怎么办？不同租户的数据会不会串在一起？新版本出错以后，系统又怎样恢复？

这些问题不是继续调整 Prompt 就能解决的。

我开始意识到：生产化并不只是把 Agent 放到一台服务器上，而是让 Runtime 能够限制故障的影响范围，并在异常发生后安全恢复。

## 秘密不能依赖模型“记得保密”

之前学习 Guardrails 时，我已经确认过：

> Prompt 是软约束，Runtime 才能建立硬边界。

这条原则同样适用于 Token、API Key 和其他秘密。

如果把邮件服务的 Token 放进模型上下文，然后在 Prompt 中要求：

```text
不要向用户泄漏 Token。
```

模型可能大多数时候都会遵守，但这无法形成百分之百的安全边界。

上下文中的信息已经进入模型可见范围。提示注入、复杂上下文、异常回显或者工具错误，都可能让秘密重新出现在输出中。

因此，今天的 Demo 没有把 Token 交给模型。

模型只能看到任务和允许使用的工具：

```js
const modelContext = {
  input,
  availableTools: ["send_email"]
};
```

Runtime 在真正调用邮件服务时，才从环境变量中读取 Token：

```js
const token = env.DEMO_EMAIL_TOKEN;

const toolResult = callEmailProvider({
  authorization: `Bearer ${token}`,
  message: input
});
```

公开 Trace 只记录秘密来自哪里、由谁注入，不记录秘密本身：

```js
publicTrace: {
  stage: "tool_transport",
  secretSource: "environment",
  secretInjectedBy: "runtime",
  secretValue: "[REDACTED]"
}
```

对应测试还会序列化整个公开结果，确认其中不包含原始 Token。

这让我把“秘密不进入模型上下文”理解成了一条完整链路：

```text
Runtime 从安全位置读取秘密
→ 只在工具传输边界注入
→ 不进入模型上下文
→ 不进入工具返回
→ 不进入公开 Trace 和错误日志
```

这里的重点并不是环境变量本身有多高级。

真实生产环境可能使用 Secret Manager、短期凭证或工作负载身份。真正需要保持不变的是：秘密由 Runtime 管理，而不是交给模型以后再要求模型保密。

## 限流和超时解决的是两个不同问题

我以前容易把限流和超时都理解成“防止请求太多”。

今天才把它们真正分开：

| 机制 | 限制的对象 | 主要防止的问题 |
| --- | --- | --- |
| 限流 | 请求数量、并发量或调用额度 | 短时间内进入过多任务 |
| 超时 | 单次调用占用资源的时间 | 少量请求长期占用连接和执行资源 |

限流发生在工具调用之前。

当前 Demo 达到容量上限后，会直接返回：

```js
{
  status: "rate_limited",
  stage: "before_tool_call",
  retryAfterMs: 1_000
}
```

这意味着请求还没有进入外部工具，不会继续消耗下游资源。

超时处理的是另一种情况：请求数量可能很少，但某次工具调用长时间没有返回。

Demo 使用 `AbortSignal.timeout` 限制等待时间：

```js
await delay(providerDelayMs, undefined, {
  signal: AbortSignal.timeout(timeoutMs)
});
```

超过时间后返回：

```js
{
  status: "timed_out",
  stage: "during_tool_call",
  timeoutMs
}
```

因此，只有限流没有超时，少量慢请求仍然可能长期占用资源；只有超时没有限流，大量快速请求仍然可能瞬间压垮系统。

当前 Demo 的请求上限只是教学用的简化计数。真实系统还需要根据场景选择滑动窗口、令牌桶、并发控制或租户额度。

超时也存在一个重要边界：只有取消信号真正传递到下游请求时，外部工作才会停止。否则 Runtime 可能只是停止等待，外部服务仍然在继续执行。

## 队列可以吸收突发流量，但不能制造容量

当请求速度超过 worker 的处理速度时，可以先把任务放进队列。

Demo 中，任务进入系统后先被登记为：

```js
{
  id: "job-1",
  status: "queued"
}
```

worker 开始处理时，状态变成 `running`，随后进入 `completed` 或 `failed`。

这能够把入口流量和实际执行速度分开，让任务不必全部同时进入工具调用。

但队列只能缓冲压力，不能让系统拥有无限容量。

如果进入速度长期大于处理速度，队列还是会持续增长。因此，生产 Runtime 至少应该观察：

- 当前队列长度；
- 最老任务已经等待多久；
- 连续失败次数；
- 消费速度是否持续低于进入速度。

当前 Demo 只实现了“连续失败达到阈值后告警”：

```js
if (consecutiveFailures >= alertAfterFailures) {
  alerts.push({
    type: "consecutive_worker_failures",
    count: consecutiveFailures,
    lastJobId: job.id
  });
}
```

队列长度和最老任务等待时间仍只是这次学习中识别出的生产指标，没有在教学代码中完整实现。

这个边界需要明确保留，否则很容易把“存在队列”误认为“系统已经能够处理任意流量”。

## 会话 ID 不是多租户隔离边界

Agent 通常会使用 `conversationId` 或 `sessionId` 保存会话状态。

我以前可能会默认：不同会话 ID 对应不同数据，所以它们天然是隔离的。

但在多租户系统中，只使用会话 ID 并不够。

两个租户可能提交相同的会话 ID；如果存储、缓存或队列只按会话 ID 查询，就可能发生跨租户串读。

今天的 Demo 要求每一次读写都同时携带：

```text
tenantId
+
conversationId
```

存储键由两者共同组成：

```js
function keyFor(tenantId, conversationId) {
  return JSON.stringify([
    tenantId,
    conversationId
  ]);
}
```

Runtime 还会拒绝缺少任意一个身份字段的操作。

这让我意识到，租户身份不能只在入口校验一次，然后在内部链路中丢失。

它需要贯穿：

```text
请求入口
→ 会话状态
→ 数据库存储
→ 缓存
→ 队列任务
→ Tool 调用
→ Trace 与日志查询
```

当前 Demo 使用内存 `Map` 验证隔离规则，不代表它已经具备生产数据库的权限控制。但“租户身份必须贯穿整条链路”这个原则可以继续迁移。

## 回滚不是“感觉新版本有问题”

前面的秘密、限流、超时、队列和数据隔离，都在控制 Agent 运行时的风险。

如果发布的新版本本身已经存在问题，Runtime 还需要一种恢复机制。

今天的故障演练保留了两个版本：

```text
stableVersion = v1
candidateVersion = v2
```

候选版本发布后，Runtime 检查两个信号：

- 健康检查是否通过；
- 错误率是否超过阈值。

我亲手补全的回滚条件是：

```js
return !healthOk
  || errorRate > maxErrorRate;
```

这段代码很短，但它表达了一个完整的生产规则：

```text
候选版本不健康
或者
候选版本错误率超过阈值
→ 拒绝候选版本
→ 恢复上一稳定版本
```

补全之前，回滚定向测试只有 1/3 通过；补全后变成 3/3，完整 Demo 的 14 条测试全部通过。

随后，我又亲自访问了本机故障演练端点：

```text
/drill?healthOk=false&errorRate=0.01
```

返回结果是：

```json
{
  "action": "rollback",
  "activeVersion": "v1",
  "rejectedVersion": "v2"
}
```

这次演练让我把“回滚”从一个部署名词，变成了可以观察的状态变化：

```text
v2 成为候选版本
→ 健康信号不满足策略
→ Runtime 拒绝 v2
→ v1 重新成为活动版本
```

它也连接回了上一篇文章中的 Eval 和 Trace。

Eval 可以在发布前发现已知退化，Trace 和监控可以在运行后产生真实信号，回滚策略则根据这些信号执行恢复。

## 健康检查和就绪检查也不是一回事

Demo 暴露了两个基础端点：

```text
/health
/ready
```

`/health` 表示服务进程仍然可以响应，并返回当前版本。

`/ready` 进一步检查运行所需的配置是否存在。当前示例会判断邮件 Token 是否已经配置，但只返回布尔状态，不返回 Token 内容。

这两个端点回答的问题不同：

- Health：这个实例还活着吗？
- Readiness：这个实例现在具备接收任务的条件吗？

一个进程可能仍然存活，却因为缺少配置、依赖不可用或初始化未完成而不能安全处理请求。

因此，只检查“服务端口能打开”并不足以证明 Agent 已经准备好工作。

## 生产 Runtime 不是一个单独模块

学习到这里，我发现部署与生产化并没有离开前面的 Agent 主链路。

最早我理解的 Agent 循环是：

```text
用户输入
→ Runtime 调用 LLM
→ LLM 提出 Tool Call
→ Runtime 校验并执行 Tool
→ Runtime 回填结果
→ LLM 继续决策
```

后来又补上了：

```text
Eval
→ 判断固定样本中的实际链路是否符合预期

Guardrails
→ 阻断未经授权或超出职责的行动

Trace
→ 记录真实执行过程和失败位置
```

今天继续补上的，是这条链路进入长期运行环境以后需要的保护：

```text
Secret Boundary
→ 防止凭证进入模型与公开输出

Rate Limit + Timeout
→ 控制请求数量和单次资源占用时间

Queue + Alert
→ 缓冲突发流量并暴露积压与失败

Tenant Isolation
→ 防止不同租户的数据互相污染

Health + Rollback
→ 用可观测信号拒绝故障版本并恢复
```

它们并不是几组互不相关的生产术语。

它们共同回答的是：

> 当模型、工具、下游服务、用户流量或新版本出现异常时，系统能不能把影响限制在已知范围内，并留下足够证据恢复？

## 完整 Demo

本文对应的完整案例：

[Agent 生产 Runtime Demo](https://github.com/Nuibia/ai-learning-notes/tree/main/examples/2026-08-10-agent-production-runtime)

运行完整测试：

```bash
node --test
```

实际结果：

```text
14 tests
14 pass
0 fail
```

运行秘密管理示例：

```bash
DEMO_EMAIL_TOKEN=local-demo-secret node demo.mjs
```

启动本机 HTTP 服务：

```bash
DEMO_EMAIL_TOKEN=local-demo-secret \
RELEASE_VERSION=v2 \
PORT=4173 \
node server.mjs
```

这个 Demo 验证的是本机可访问部署和 Runtime 控制逻辑。

它没有使用真实 Secret Manager、持久化队列、生产数据库、多实例共享状态或公网托管，因此不能被描述为一套已经可以直接上线的生产方案。

## 最后

上一篇文章结束时，我认为自己正在从“让 Agent 能工作”，走向“判断 Agent 是否可靠”。

今天，我又在“可靠”后面补了一层：

> 可靠不只是回答正确，也包括秘密不会进入错误边界、资源不会被无限占用、租户数据不会串读，以及错误版本能够被安全撤回。

Prompt 可以告诉模型应该怎样行动，Eval 可以衡量它是否按预期行动，Trace 可以记录它实际上怎样行动。

但真正决定故障影响范围的，仍然是 Runtime。

这也让我重新理解了所谓的 Agent 生产化：

> 它不是把 Agent 启动在一台服务器上，而是让每一种失败都有边界、有证据，并且有恢复路径。