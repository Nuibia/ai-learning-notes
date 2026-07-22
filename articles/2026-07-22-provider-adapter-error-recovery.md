# 从一个最小 Runtime Demo 看懂：陌生的 599 为什么不能重试

> 完整案例代码：[多供应商 Adapter 与有限重试 Runtime](../examples/2026-07-22-provider-adapter-retry-runtime/)

最近几天学习 Agent Runtime 时，我一直在反复接触同一套骨架：LLM 生成候选动作，Runtime 校验并执行，工具参数先经过 Schema，循环和权限由代码控制。

我开始觉得每天都在说差不多的东西。今天真正增加的新内容，是把供应商差异挡在 Runtime 外面的 adapter。

不同供应商可能用不同的状态码和错误码表达失败。如果 Runtime 直接理解每家供应商的原始错误，它的重试逻辑就会逐渐和供应商耦合。今天的 Demo 增加了一个 `provider-error-adapter.mjs`，先把原始错误转换成 Runtime 认识的内部错误：

```js
if (status === 429 || code === "ETIMEDOUT") {
  return new TransientToolError("TRANSIENT_PROVIDER_FAILURE");
}

if (status === 401 || status === 403) {
  return new ToolAuthorizationError("PROVIDER_AUTHORIZATION_FAILED");
}

return new UnknownProviderError("UNKNOWN_PROVIDER_FAILURE");
```

这里的 429、401、403 只是教学 Demo 定义的 HTTP 供应商契约，不是所有供应商都必须遵守的通用标准。换一家供应商时，应该由它自己的 adapter 根据正式错误契约完成映射，Runtime 不需要解析供应商的自然语言报错。

错误进入 Runtime 后，是否重试仍然由两个条件共同决定：

```js
const canRetry = error instanceof TransientToolError;
const hasAttemptsLeft = attempt < maxToolAttempts;

if (!canRetry || !hasAttemptsLeft) {
  throw error;
}
```

`canRetry` 表示这种错误是否允许重试，`hasAttemptsLeft` 表示允许重试以后是否还有尝试次数。任一条件为假，当前操作都会立即终止。

测试里注入了一个 adapter 从未见过的 HTTP 599。它被转换成 `UnknownProviderError`，所以即使 `maxToolAttempts = 3`，`canRetry` 仍然是 `false`，供应商实际只被调用了一次。

这也纠正了我当时的一个回答：代码里的 `for` 循环只能说明静态上限，测试中的 `providerCalls === 1` 才是这次 599 没有重复调用的运行证据。

今天还把 `maxToolRetries` 改成了 `maxToolAttempts`。前者需要记住“重试两次等于总共尝试三次”的隐含换算；后者直接表示包含首次调用在内的总尝试次数：

```js
for (let attempt = 1; attempt <= maxToolAttempts; attempt += 1) {
  // 执行工具
}
```

非法配置也会在第一次模型调用前显式失败：

```js
if (!Number.isInteger(maxToolAttempts) || maxToolAttempts < 1) {
  throw new InvalidRetryPolicyError(
    "MAX_TOOL_ATTEMPTS_MUST_BE_A_POSITIVE_INTEGER",
  );
}
```

因此 `0`、负数、小数和 `NaN` 都不会被静默修正，也不会继续进入模型与工具循环。对应测试观察到模型调用和工具调用都为零。

完整 Demo 一共有十条测试：429 在有限预算内重试，403 立即终止，陌生 599 立即终止，暂时性错误达到总尝试次数后停止，非法配置在生命周期开始前失败。实际运行结果是十条全部通过。

这些代码由 AI 生成并运行。我完成的是选择 `maxToolAttempts` 的计数语义、要求非法配置前置失败、决定在 provider adapter 统一供应商错误，并根据代码和调用计数解释 429、403 和 599 的不同结果。

我现在真正形成的判断是：供应商错误先由 adapter 归一化，Runtime 再依据稳定的内部错误类型和明确的尝试预算决定重试或终止。有剩余次数不等于获得重试授权；陌生错误在正式契约确认前应该失败关闭。对于可能已经成功的非幂等写操作，次数预算更不能代替幂等键、权限或人工确认。