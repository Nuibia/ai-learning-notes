# L19 Demo：状态机、检查点与人工介入

今天采用 `demo-first`，从一个最小的统一运行状态开始，随后再逐步加入：

1. 状态迁移；
2. 检查点持久化；
3. 失败恢复；
4. 人工确认；
5. 状态所有权校验。

当前已经完成五步：

1. 用统一 `runState` 保存恢复流程需要的事实；
2. 把状态原子写入 `checkpoint.json`，模拟 Runtime 重启后重新读取。
3. 模拟“服务端已执行、响应却超时”，Runtime 使用持久化的同一个幂等键恢复，避免重复创建报销记录。
4. 对资金操作暂停自动恢复，持久化人工处理原因与允许动作；UI 展示选项，Runtime 校验用户选择后再恢复执行。
5. 模拟两个页面先后提交冲突决定：第一个页面已恢复并完成后，Runtime 根据最新持久化状态拒绝第二个页面迟到的取消请求。

运行：

```bash
node demo.mjs
```

`runState` 同时保存输入、意图、当前状态、待执行动作、最终结果和错误。`validateRunState` 用最小约束避免字段互相矛盾。

`saveCheckpoint` 先写临时文件，再用重命名替换正式检查点，避免程序在写到一半时留下残缺 JSON。恢复时，`loadCheckpoint` 不只读取文件，还会再次校验状态。

`externalReimbursementRecords` 模拟 Runtime 之外的报销服务。第一次调用已经创建记录，但 Runtime 只收到超时；恢复时再次使用相同 `idempotencyKey`，服务端返回原结果，最终记录数仍为 1。

`waiting_human_review` 和 `humanReview` 是本 Demo 自定义的字段名，并非社区强制规范。通用原则是：无法安全自动判断时，把人工处理点做成可持久化、可校验、可恢复的 Runtime 状态。

人拥有业务决定权，但 Runtime 才是运行状态的事实来源。UI 传来的操作只是请求；Runtime 必须依据最新状态判断这次请求是否仍然有效。

## L20：使用真实框架重构

`framework-demo.mjs` 使用 LangGraph JS 把“校验授权 → 执行工具 → 完成运行”改造成三个节点。框架负责按边执行节点，并通过 `thread_id` 管理检查点；状态字段、授权规则、幂等键和工具逻辑仍由应用 Runtime 定义。

```bash
npm install
npm start
```

示例使用 `MemorySaver`，只适合观察框架行为；它不能替代生产数据库，也不能在 Node 进程重启后保留检查点。

`framework-demo.mjs` 同时展示两类记录：

- `trace` 是应用自己定义在 State 里的业务说明；
- `getStateHistory()` 读取的是 LangGraph 自动保存的检查点历史。

两者都不等于完整可观测性。若要查看模型、工具和节点调用的耗时、输入输出等完整 Trace，通常还需要接入 LangSmith 或自己的可观测系统。
